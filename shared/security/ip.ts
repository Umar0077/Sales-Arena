/**
 * IPv4 / IPv6 parsing and exact CIDR matching (numeric, never string prefixes).
 * No Node or browser APIs: shared by the Admin form (instant validation), the request proxy and tests.
 * PostgreSQL (`cidr` column) validates every stored rule again on save.
 */

export type Family = 4 | 6;
export interface ParsedIp {
  family: Family;
  value: bigint;
}
export interface ParsedNetwork {
  family: Family;
  base: bigint;
  prefix: number;
  /** Canonical text, e.g. "192.0.2.0/24", "203.0.113.25/32", "2001:db8::/32". */
  cidr: string;
}

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || (p.length > 1 && p.startsWith("0"))) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseV6(input: string): bigint | null {
  let s = input.toLowerCase();
  if (!s || s.includes("%") || !/^[0-9a-f:.]+$/.test(s)) return null; // zone ids and junk rejected
  // Embedded IPv4 tail (e.g. ::ffff:192.0.2.1)
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = parseV4(s.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [Number(v4 >> 16n), Number(v4 & 0xffffn)];
    s = s.slice(0, lastColon + 1) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((g) => parseInt(g, 16));
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}


/** Parses a single address. IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as the IPv4 address. */
export function parseIp(input: string | null | undefined): ParsedIp | null {
  const s = (input ?? "").trim();
  if (!s || s.length > 64) return null;
  if (s.includes(":")) {
    const v = parseV6(s);
    if (v === null) return null;
    if (v >> 32n === 0xffffn) return { family: 4, value: v & 0xffffffffn };
    return { family: 6, value: v };
  }
  const v = parseV4(s);
  return v === null ? null : { family: 4, value: v };
}

function formatV4(v: bigint): string {
  return [24n, 16n, 8n, 0n].map((sh) => String((v >> sh) & 0xffn)).join(".");
}
function formatV6(v: bigint): string {
  const g = Array.from({ length: 8 }, (_, i) => Number((v >> BigInt((7 - i) * 16)) & 0xffffn));
  // Compress the longest run of zero groups (RFC 5952).
  let best = -1, bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen && j - i > 1) [best, bestLen] = [i, j - i];
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best < 0) return hex.join(":");
  return `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
}
export function formatIp(p: ParsedIp): string {
  return p.family === 4 ? formatV4(p.value) : formatV6(p.value);
}

export type NetworkResult = { ok: true; network: ParsedNetwork } | { ok: false; error: string };

/** Accepts "203.0.113.25", "192.0.2.0/24", "2001:db8::/32". Host bits must be zero ("192.0.2.5/24" is rejected). */
export function parseNetwork(input: string | null | undefined): NetworkResult {
  const s = (input ?? "").trim();
  if (!s) return { ok: false, error: "Enter an IP address or CIDR range." };
  const [addr, prefixText, extra] = s.split("/");
  if (extra !== undefined) return { ok: false, error: "Use one address or one CIDR range, e.g. 192.0.2.0/24." };
  const ip = parseIp(addr);
  if (!ip || (addr.includes(":") && ip.family === 4 && prefixText !== undefined))
    return { ok: false, error: "That is not a valid IPv4 or IPv6 address." };
  const max = ip.family === 4 ? 32 : 128;
  let prefix = max;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > max) return { ok: false, error: `The prefix must be a number from 0 to ${max}.` };
    prefix = Number(prefixText);
  }
  if (prefix === 0) return { ok: false, error: "A /0 range would allow every network. Use a specific address or range." };
  const hostBits = BigInt(max - prefix);
  const mask = ((1n << BigInt(max)) - 1n) ^ ((1n << hostBits) - 1n);
  if ((ip.value & ~mask & ((1n << BigInt(max)) - 1n)) !== 0n) {
    const base = { family: ip.family, value: ip.value & mask } as ParsedIp;
    return { ok: false, error: `That range has host bits set. Did you mean ${formatIp(base)}/${prefix}?` };
  }
  return { ok: true, network: { family: ip.family, base: ip.value, prefix, cidr: `${formatIp(ip)}/${prefix}` } };
}

export function ipInNetwork(ip: ParsedIp, net: Pick<ParsedNetwork, "family" | "base" | "prefix">): boolean {
  if (ip.family !== net.family) return false;
  const max = net.family === 4 ? 32 : 128;
  const shift = BigInt(max - net.prefix);
  return ip.value >> shift === net.base >> shift;
}

export function networksOverlap(a: ParsedNetwork, b: ParsedNetwork): boolean {
  if (a.family !== b.family) return false;
  const p = Math.min(a.prefix, b.prefix);
  const shift = BigInt((a.family === 4 ? 32 : 128) - p);
  return a.base >> shift === b.base >> shift;
}

/** "/32" and "/128" are shown as the plain address. */
export function displayNetwork(cidr: string): string {
  return cidr.includes(":") ? cidr.replace(/\/128$/, "") : cidr.replace(/\/32$/, "");
}

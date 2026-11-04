import { describe, it, expect } from "vitest";
import { SseParser } from "@/lib/server/safequote/sse-parser";
import { parseSseSaleEvent } from "@/lib/server/safequote/mapper";

const sale = (n: number) =>
  `id: evt-${n}\nevent: sale.validated\ndata: ${JSON.stringify({ caseId: `CASE-${n}`, closer: { userCode: "CLS-1", name: "Test Closer" }, validatedAt: "2026-11-04T10:00:00Z", premium: 50 })}\n\n`;
const STREAM = `: ping\n\n${sale(1)}: ping\n\n${sale(2)}${sale(3)}`;

/** The previous inline loop in sse-consumer.ts (message state reset on every network chunk). */
function oldParser(chunks: string[]) {
  const out: Array<{ event: string; data: string }> = [];
  let buffer = "";
  for (const chunk of chunks) {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() || "";
    let currentEvent = "message";
    let currentData = "";
    for (const line of lines) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
      else if (line.startsWith("data:")) currentData += (currentData ? "\n" : "") + line.slice(5).trim();
      else if (line.trim() === "" && currentData) {
        out.push({ event: currentEvent, data: currentData });
        currentEvent = "message";
        currentData = "";
      }
    }
  }
  return out;
}

function feed(chunks: string[]) {
  const p = new SseParser();
  return chunks.flatMap((c) => p.push(c));
}

describe("Safe Quote SSE parser", () => {
  it("whole stream at once: three sales, ids, comments ignored", () => {
    const m = feed([STREAM]);
    expect(m.map((x) => [x.event, x.id, JSON.parse(x.data).caseId])).toEqual([
      ["sale.validated", "evt-1", "CASE-1"],
      ["sale.validated", "evt-2", "CASE-2"],
      ["sale.validated", "evt-3", "CASE-3"],
    ]);
  });

  it("root cause: the old loop lost a sale whenever a chunk boundary fell inside a message", () => {
    // Split between a sale's data line and its terminating blank line (very common on real networks).
    const cut = STREAM.indexOf("\n\n", STREAM.indexOf("CASE-2")) + 1;
    const chunks = [STREAM.slice(0, cut), STREAM.slice(cut)];
    expect(oldParser(chunks).map((x) => JSON.parse(x.data).caseId)).toEqual(["CASE-1", "CASE-3"]); // CASE-2 lost
    expect(feed(chunks).map((x) => JSON.parse(x.data).caseId)).toEqual(["CASE-1", "CASE-2", "CASE-3"]);
  });

  it("every possible split point (and byte-by-byte delivery) yields all three sales, typed correctly", () => {
    for (let cut = 1; cut < STREAM.length; cut++) {
      const m = feed([STREAM.slice(0, cut), STREAM.slice(cut)]);
      expect(m.map((x) => JSON.parse(x.data).caseId), `split at ${cut}`).toEqual(["CASE-1", "CASE-2", "CASE-3"]);
      expect(m.every((x) => x.event === "sale.validated")).toBe(true);
    }
    expect(feed(STREAM.split("")).map((x) => x.id)).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  it("CRLF and CR line endings, including a CRLF split across chunks", () => {
    const crlf = STREAM.replace(/\n/g, "\r\n");
    for (let cut = 1; cut < crlf.length; cut += 7) expect(feed([crlf.slice(0, cut), crlf.slice(cut)])).toHaveLength(3);
    expect(feed([STREAM.replace(/\n/g, "\r")])).toHaveLength(3);
  });

  it("multi-line data, no space after the colon, comments flagged as heartbeats", () => {
    const p = new SseParser();
    expect(p.push(": ping\n")).toEqual([]);
    expect(p.takeComment()).toBe(true);
    expect(p.takeComment()).toBe(false);
    expect(p.push("event:sale.validated\ndata:{\"a\":\ndata:1}\n\n")).toEqual([{ event: "sale.validated", data: '{"a":\n1}', id: "" }]);
  });

  it("a parsed split event still maps to a validated sale (the mapper sees the right type and payload)", () => {
    const cut = STREAM.indexOf("data:", STREAM.indexOf("evt-2")) + 3;
    const m = feed([STREAM.slice(0, cut), STREAM.slice(cut)])[1];
    const n = parseSseSaleEvent(m.event, JSON.parse(m.data));
    expect(n).toMatchObject({ eventType: "sale.validated", caseId: "CASE-2", userCode: "CLS-1" });
  });
});

import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id with the OWASP-recommended baseline (19 MiB memory, 2 iterations, 1 lane).
 * @node-rs/argon2 defaults to Argon2id; we assert the prefix so a library change can
 * never silently store a weaker hash (the database CHECK enforces it too).
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export async function hashPassword(password: string): Promise<string> {
  const h = await hash(password, OPTIONS);
  if (!h.startsWith("$argon2id$")) throw new Error("Password hashing did not produce an Argon2id hash");
  return h;
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Spends the same work as a real check when the account doesn't exist (no user enumeration by timing). */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hash("sales-arena-dummy-password-for-timing", OPTIONS);
  await verifyPassword(await dummyHash, password);
  return false;
}

/** Returns an error message, or null when the password is acceptable. */
export function validateNewPassword(password: unknown, email?: string): string | null {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (/^(.)\1+$/.test(password)) return "Password cannot be one repeated character.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4)
    return "Password must not contain your email name.";
  return null;
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  if (e.length < 3 || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

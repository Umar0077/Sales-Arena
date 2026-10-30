#!/usr/bin/env node
// Create a Sales Arena administrator (interactive, one-time bootstrap).
//
//   node --env-file=/etc/sales-arena/sales-arena.env scripts/create-admin.mjs
//   node --env-file=... scripts/create-admin.mjs --additional   # add another admin later
//
// - Reads the email normally and the password WITHOUT echoing it (no asterisks either).
// - Refuses to run when stdin is not an interactive terminal, so a password can never
//   come from a pipe, shell history or a file.
// - Refuses when an admin already exists, unless --additional is given.
// - Stores only an Argon2id hash. The password is never printed or logged.

import pg from "pg";
import readline from "node:readline/promises";
import { hash } from "@node-rs/argon2";

const ADDITIONAL = process.argv.includes("--additional");
const url = process.env.DATABASE_URL;

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

if (!url) fail("DATABASE_URL is not set. Run with: node --env-file=<env file> scripts/create-admin.mjs", 2);
if (!process.stdin.isTTY) fail("Run this command in an interactive terminal. Passwords cannot be piped in.", 2);

function askHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\nCancelled.\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function validatePassword(pw, email) {
  if (pw.length < 12) return "Use at least 12 characters.";
  if (pw.length > 128) return "Use at most 128 characters.";
  if (/^(.)\1+$/.test(pw)) return "Password cannot be one repeated character.";
  const local = email.split("@")[0];
  if (local.length >= 4 && pw.toLowerCase().includes(local.toLowerCase())) return "Password must not contain your email name.";
  return null;
}

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
try {
  const db = new URL(url).pathname.replace(/^\//, "");
  const table = await pool.query(`SELECT to_regclass('public.admin_users') AS t`);
  if (!table.rows[0].t) fail(`admin_users table not found in "${db}". Run migrations first: npm run db:migrate -- up`);

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM admin_users`);
  if (rows[0].n > 0 && !ADDITIONAL) fail(`An administrator already exists in "${db}". Use --additional to add another one.`);

  console.log(`Creating ${rows[0].n === 0 ? "the first (owner)" : "an additional"} administrator in database "${db}".`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question("Admin email: ")).trim().toLowerCase();
  const displayName = (await rl.question("Display name (optional): ")).trim().slice(0, 128);
  rl.close();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail("That email address is not valid.");

  const exists = await pool.query(`SELECT 1 FROM admin_users WHERE LOWER(email) = $1`, [email]);
  if (exists.rowCount) fail("An administrator with that email already exists.");

  const password = await askHidden("Password (input hidden): ");
  const problem = validatePassword(password, email);
  if (problem) fail(problem);
  const confirm = await askHidden("Confirm password: ");
  if (confirm !== password) fail("Passwords do not match. Nothing was created.");

  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  if (!passwordHash.startsWith("$argon2id$")) fail("Hashing failed to produce Argon2id. Nothing was created.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = rows[0].n === 0 ? "owner" : "admin";
    const ins = await client.query(
      `INSERT INTO admin_users (email, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, displayName, passwordHash, role],
    );
    await client.query(
      `INSERT INTO audit_logs (actor, admin_id, action, target_type, target_id, details) VALUES ('cli', $1, 'admin.bootstrap', 'admin_user', $1, $2)`,
      [ins.rows[0].id, JSON.stringify({ role, via: "scripts/create-admin.mjs" })],
    );
    await client.query("COMMIT");
    console.log(`Administrator created (${role}). Sign in at /admin/login.`);
  } catch (err) {
    await client.query("ROLLBACK");
    fail(`Could not create the administrator: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

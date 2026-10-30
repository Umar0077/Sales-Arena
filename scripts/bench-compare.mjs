#!/usr/bin/env node
// A/B performance comparison of two production builds of the Live Arena.
//
//   node scripts/bench-compare.mjs <beforeDir> <afterDir> [runs=3]
//
// Each build runs under `next start` on its own port. Runs are interleaved (B,A,B,A,…)
// to spread API/network drift. Every run uses a fresh browser context (cold cache),
// 4× CPU throttle, a fixed network profile and a 1366×768 desktop viewport.
// Reports medians. Live Safe Quote latency is part of "time to real data" by design.

import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const [beforeDir, afterDir, runsArg] = process.argv.slice(2);
const RUNS = Number(runsArg) || 3;
if (!beforeDir || !afterDir) {
  console.error("usage: node scripts/bench-compare.mjs <beforeDir> <afterDir> [runs]");
  process.exit(2);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function up(url, timeout = 60000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () =>
      http
        .get(url, (res) => (res.statusCode < 500 ? resolve() : setTimeout(ping, 400)))
        .on("error", () => (Date.now() - t0 > timeout ? reject(new Error(`timeout ${url}`)) : setTimeout(ping, 400)));
    ping();
  });
}

function start(dir, port) {
  const p = spawn(process.execPath, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: dir,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production", ADMIN_COOKIE_SECURE: "false", SALES_ARENA_SYNC_ENABLED: "false" },
  });
  return p;
}

async function measure(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 });
  await cdp.send("Performance.enable");
  await page.addInitScript(() => {
    window.__lt = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push({ s: e.startTime, d: e.duration }))).observe({ type: "longtask", buffered: true });
    } catch {}
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load" });
  let dataMs = null;
  try {
    await page.getByRole("region", { name: "Leaderboard" }).waitFor({ timeout: 45000 });
    dataMs = Date.now() - t0;
  } catch {}
  await wait(3000); // settle

  // Idle CPU: main-thread task time over 8 s with nothing happening.
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const a = await metric();
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t = performance.now();
        const f = () => (performance.now() - t < 8000 ? (n++, requestAnimationFrame(f)) : resolve(n / 8));
        requestAnimationFrame(f);
      }),
  );
  const b = await metric();

  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")?.startTime ?? null;
    const tbt = window.__lt.filter((t) => fcp === null || t.s >= fcp).reduce((s, t) => s + Math.max(0, t.d - 50), 0);
    const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    const js = performance.getEntriesByType("resource").filter((e) => e.initiatorType === "script").reduce((s, e) => s + (e.transferSize || 0), 0);
    return { fcp, tbt, load: nav.loadEventEnd, longTasks: window.__lt.length, heap, jsKB: Math.round(js / 1024) };
  });
  await context.close();
  return { ...r, dataMs, idleCpuPct: ((b.TaskDuration - a.TaskDuration) / 8) * 100, idleFps: fps };
}

const median = (xs) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x)).sort((p, q) => p - q);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};

const targets = [
  { name: "before", dir: path.resolve(beforeDir), port: 3201 },
  { name: "after", dir: path.resolve(afterDir), port: 3202 },
];
const procs = targets.map((t) => start(t.dir, t.port));
try {
  await Promise.all(targets.map((t) => up(`http://127.0.0.1:${t.port}/api/arena/summary`)));
  const browser = await chromium.launch({ headless: true });
  // Warm-up (server JIT + upstream cache), not counted.
  for (const t of targets) await measure(browser, `http://127.0.0.1:${t.port}/`).catch(() => {});
  const results = { before: [], after: [] };
  for (let i = 0; i < RUNS; i++) {
    for (const t of targets) {
      const r = await measure(browser, `http://127.0.0.1:${t.port}/`);
      results[t.name].push(r);
      console.log(`${t.name} run ${i + 1}:`, JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 10) / 10 : v]))));
    }
  }
  await browser.close();
  const keys = ["fcp", "tbt", "load", "dataMs", "longTasks", "idleCpuPct", "idleFps", "heap", "jsKB"];
  console.log("\nMEDIANS");
  console.log(["metric", "before", "after"].join("\t"));
  for (const k of keys) console.log([k, median(results.before.map((r) => r[k])), median(results.after.map((r) => r[k]))].map((v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v)).join("\t"));
} finally {
  for (const p of procs) p.kill();
}

import { chromium } from "playwright";
import http from "http";

function checkServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function ping() {
      const req = http.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) resolve();
        else setTimeout(ping, 300);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("Server timeout"));
        else setTimeout(ping, 300);
      });
    }
    ping();
  });
}

async function run() {
  console.log(">>> Connecting to server on http://127.0.0.1:3000 ...");
  await checkServer("http://127.0.0.1:3000");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--enable-gpu-rasterization"],
  });

  const context = await browser.newContext({
    viewport: { width: 354, height: 858 }, // Lighthouse mobile viewport
    userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();

  // Collect performance marks and observer data
  await page.addInitScript(() => {
    window.__perf_metrics = {
      fcp: null,
      lcp: null,
      cls: 0,
      longTasks: [],
      rafDeltas: [],
    };

    // Long tasks
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perf_metrics.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Ignored
    }

    // Layout shifts
    try {
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__perf_metrics.cls += entry.value;
          }
        }
      });
      clsObserver.observe({ entryTypes: ["layout-shift"] });
    } catch {
      // Ignored
    }

    // LCP
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          window.__perf_metrics.lcp = entries[entries.length - 1].startTime;
        }
      });
      lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
    } catch {
      // Ignored
    }
  });

  console.log(">>> Navigating to / (Live Arena)...");
  const navStart = Date.now();
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
  const loadDuration = Date.now() - navStart;

  // Let it settle for 3s to capture idle FPS and background work
  await page.evaluate(() => {
    return new Promise((resolve) => {
      let last = performance.now();
      let frames = 0;
      function frame(now) {
        window.__perf_metrics.rafDeltas.push(now - last);
        last = now;
        frames++;
        if (frames < 120) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  });

  const metrics = await page.evaluate(() => {
    const p = window.__perf_metrics;
    const paint = performance.getEntriesByType("paint");
    const fcpEntry = paint.find((e) => e.name === "first-contentful-paint");
    const fcp = fcpEntry ? fcpEntry.startTime : null;
    
    // TBT = sum of (duration - 50ms) for all long tasks between FCP and TTI/3000ms
    const tbt = p.longTasks.reduce((acc, t) => acc + Math.max(0, t.duration - 50), 0);
    const totalBlockingDuration = p.longTasks.reduce((acc, t) => acc + t.duration, 0);

    // Compute idle FPS
    const deltas = p.rafDeltas.filter((d) => d > 0);
    const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 16.67;
    const idleFps = Math.round(1000 / avgDelta);

    const memory = performance.memory ? {
      usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
    } : null;

    const domNodes = document.getElementsByTagName("*").length;

    return {
      fcp: Math.round(fcp || 0),
      lcp: Math.round(p.lcp || fcp || 0),
      cls: Number(p.cls.toFixed(4)),
      tbt: Math.round(tbt),
      longTaskCount: p.longTasks.length,
      totalBlockingDuration: Math.round(totalBlockingDuration),
      idleFps,
      domNodes,
      memory,
    };
  });

  console.log("\n=================== PERFORMANCE MEASUREMENTS ===================");
  console.log(`Page Load Time:       ${loadDuration} ms`);
  console.log(`FCP:                  ${metrics.fcp} ms`);
  console.log(`LCP:                  ${metrics.lcp} ms`);
  console.log(`CLS:                  ${metrics.cls}`);
  console.log(`TBT (Total Blocking): ${metrics.tbt} ms (${metrics.longTaskCount} long tasks, total blocking ${metrics.totalBlockingDuration}ms)`);
  console.log(`Idle Render FPS:      ${metrics.idleFps} FPS`);
  console.log(`DOM Element Count:    ${metrics.domNodes} nodes`);
  if (metrics.memory) {
    console.log(`JS Heap Used:         ${metrics.memory.usedJSHeapSize} MB / ${metrics.memory.totalJSHeapSize} MB`);
  }
  console.log("================================================================\n");

  await browser.close();
}

run().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});

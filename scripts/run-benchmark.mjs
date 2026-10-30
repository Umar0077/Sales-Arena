import { spawn } from "child_process";
import http from "http";

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) resolve();
        else setTimeout(check, 400);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("Server start timeout"));
        else setTimeout(check, 400);
      });
    }
    check();
  });
}

async function main() {
  console.log("Starting Next.js production server for benchmark...");
  const server = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "127.0.0.1"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  server.stdout?.on("data", (d) => {
    const s = d.toString();
    if (s.includes("Ready")) process.stdout.write(`[Next] ${s}`);
  });

  try {
    await waitForServer("http://127.0.0.1:3000/");
    console.log("Server is ready. Executing benchmark...");

    const bench = spawn("node", ["scripts/measure-perf.mjs"], { stdio: "inherit" });
    const code = await new Promise((resolve) => bench.on("close", resolve));
    console.log(`Benchmark completed with exit code: ${code}`);
  } finally {
    server.kill("SIGTERM");
    try {
      process.kill(server.pid);
    } catch {
      // Process already terminated
    }
  }
}

main().catch(console.error);

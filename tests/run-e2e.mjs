import { spawn } from "child_process";
import http from "http";

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Server start timeout"));
        } else {
          setTimeout(check, 500);
        }
      });
    }
    check();
  });
}

async function main() {
  console.log("Starting Next.js production server on http://127.0.0.1:3000 ...");
  const server = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "127.0.0.1"],
    {
      stdio: "pipe",
    }
  );

  server.stdout?.on("data", (d) => process.stdout.write(`[Next] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[Next ERR] ${d}`));

  try {
    await waitForServer("http://127.0.0.1:3000/arena");
    console.log("\n>>> Next.js server is responsive! Starting Playwright suite...\n");

    const testProc = spawn("npx", ["playwright", "test"], {
      stdio: "inherit",
      shell: true,
    });

    const exitCode = await new Promise((resolve) => {
      testProc.on("close", resolve);
    });

    console.log("\n>>> Playwright completed with exit code:", exitCode);
    process.exit(exitCode ?? 0);
  } finally {
    console.log("Stopping Next.js server...");
    try {
      if (server.pid) {
        spawn("taskkill", ["/pid", server.pid.toString(), "/f", "/t"]);
      } else {
        server.kill("SIGTERM");
      }
    } catch {
      server.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});

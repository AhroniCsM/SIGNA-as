// All-in-one launcher: API + market worker + social worker in a single process.
// Good for local dev; for prod split into 3 processes (pm2 / systemd / docker-compose).

import "dotenv/config";
import { spawn } from "child_process";

const children = [
  ["api", "src/api/server.js"],
  ["market", "src/workers/marketWorker.js"],
  ["social", "src/workers/socialWorker.js"],
];

function launch(name, file, attempt = 0) {
  const p = spawn(process.execPath, [file], { stdio: "inherit", env: process.env });
  p.on("exit", code => {
    // API crash is fatal — no point running workers with no way to serve. Workers
    // restart with exponential backoff so one bad scan doesn't kill the service.
    if (name === "api") {
      console.log(`[api] exited (${code}) — shutting down`);
      process.exit(code ?? 1);
    }
    const delay = Math.min(60_000, 2_000 * Math.pow(2, attempt));
    console.log(`[${name}] exited (${code}) — restarting in ${delay / 1000}s`);
    setTimeout(() => launch(name, file, attempt + 1), delay);
  });
  // Reset backoff once the process has survived for 2 min.
  setTimeout(() => { attempt = 0; }, 120_000);
}

for (const [name, file] of children) launch(name, file);

console.log("[signa] all processes started. Ctrl+C to stop.");

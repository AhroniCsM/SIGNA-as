// All-in-one launcher: API + market worker + social worker in a single process.
// Good for local dev; for prod split into 3 processes (pm2 / systemd / docker-compose).

import "dotenv/config";
import { spawn } from "child_process";

const children = [
  ["api", "src/api/server.js"],
  ["market", "src/workers/marketWorker.js"],
  ["social", "src/workers/socialWorker.js"],
];

for (const [name, file] of children) {
  const p = spawn(process.execPath, [file], { stdio: "inherit", env: process.env });
  p.on("exit", code => {
    console.log(`[${name}] exited (${code}) — shutting down`);
    process.exit(code ?? 1);
  });
}

console.log("[signa] all processes started. Ctrl+C to stop.");

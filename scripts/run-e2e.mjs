// Boots the Next.js dev server on an isolated test data dir, waits for it to be
// ready, runs the full vitest suite (unit + API integration), then tears down.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.PLAYPROOF_BASE ?? "http://localhost:3000";

async function up() {
  try {
    const r = await fetch(`${BASE}/api/bounties`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

let server = null;
const alreadyRunning = await up();

if (!alreadyRunning) {
  console.log("• starting dev server for e2e …");
  server = spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true });
  const start = Date.now();
  while (Date.now() - start < 60000) {
    if (await up()) break;
    await sleep(1000);
  }
  if (!(await up())) {
    console.error("✗ dev server did not become ready in 60s");
    if (server) process.kill(-server.pid);
    process.exit(1);
  }
  console.log("• server ready");
} else {
  console.log("• reusing dev server already running at", BASE);
}

const vitest = spawn("node_modules/.bin/vitest", ["run"], { stdio: "inherit" });
const code = await new Promise((res) => vitest.on("exit", res));

if (server) {
  try {
    process.kill(-server.pid);
  } catch {}
}
process.exit(code ?? 0);

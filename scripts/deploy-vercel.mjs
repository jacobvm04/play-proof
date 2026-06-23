// One-command Vercel deploy.
//
//   npm run ship
//
// Reads .env.local, pushes every var to the Vercel project (production), then
// deploys to production. Idempotent: updates vars that already exist. Assumes
// you've run `vercel login` once and deployed/seeded the 0G contract.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.local");

if (!fs.existsSync(envPath)) {
  console.error("No .env.local. Configure it for 0G (chain 16602) first — see README.");
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.NEXT_PUBLIC_PLAYPROOF_CONTRACT) {
  console.error("NEXT_PUBLIC_PLAYPROOF_CONTRACT missing — deploy the 0G contract first (CHAIN=0g npm run deploy).");
  process.exit(1);
}

const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: "pipe", ...opts }).toString().trim();

// Link the project non-interactively (no-op if already linked).
console.log("• linking Vercel project …");
try {
  run("vercel link --yes");
} catch (e) {
  console.error(e.stdout?.toString() || e.message);
  process.exit(1);
}

// Push each env var to production. Remove-then-add so re-runs update cleanly.
console.log("• syncing env vars to production …");
for (const [key, value] of Object.entries(env)) {
  try {
    run(`vercel env rm ${key} production --yes`);
  } catch {
    /* not set yet — fine */
  }
  execSync(`vercel env add ${key} production`, { cwd: root, input: value + "\n", stdio: ["pipe", "ignore", "ignore"] });
  console.log(`  ✓ ${key}`);
}

// Deploy to production.
console.log("• deploying to production …");
const url = run("vercel deploy --prod --yes");
console.log("\n✓ Live:", url.split("\n").pop());

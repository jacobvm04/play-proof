// Local EVM chain for development + on-chain e2e tests.
// Deterministic mnemonic → the same funded accounts every run, so the deploy
// script, seed script, and e2e tests can rely on known keys.
//
// Run standalone: `npm run chain` (stays up). The e2e harness also boots it.
import Ganache from "ganache";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

export const LOCAL_MNEMONIC =
  "test test test test test test test test test test test junk";
export const LOCAL_CHAIN_ID = 31337;
export const LOCAL_PORT = 8545;

export function makeServer() {
  return Ganache.server({
    wallet: { mnemonic: LOCAL_MNEMONIC, totalAccounts: 12, defaultBalance: 1000 },
    // solc 0.8.26 emits Shanghai opcodes (PUSH0); ganache defaults to an older
    // hardfork, which surfaces as "invalid opcode". Pin to shanghai to match.
    chain: { chainId: LOCAL_CHAIN_ID, networkId: LOCAL_CHAIN_ID, hardfork: "shanghai" },
    miner: { blockGasLimit: 30_000_000 },
    logging: { quiet: true },
  });
}

// Write the funded accounts to a file the deploy/seed/e2e scripts can read.
export function writeAccounts(accounts) {
  const out = path.join(root, "data", "local-accounts.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(accounts, null, 2));
  return out;
}

// When run directly, start and keep the chain alive.
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = makeServer();
  server.listen(LOCAL_PORT, (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    const provider = server.provider;
    const accounts = provider.getInitialAccounts();
    const list = Object.entries(accounts).map(([address, a]) => ({
      address,
      privateKey: a.secretKey,
    }));
    writeAccounts(list);
    console.log(`✓ Local chain on http://127.0.0.1:${LOCAL_PORT} (chainId ${LOCAL_CHAIN_ID})`);
    console.log(`  ${list.length} funded accounts (1000 ETH each). Deployer: ${list[0].address}`);
    console.log("  Accounts written to data/local-accounts.json");
    console.log("  Ctrl-C to stop.");
  });
}

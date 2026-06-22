// Compiles contracts/PlayProof.sol with solc and writes the ABI + bytecode to
// src/contracts/PlayProof.json (consumed by the deploy script and the frontend).
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const sourcePath = path.join(root, "contracts", "PlayProof.sol");
const source = fs.readFileSync(sourcePath, "utf8");

const input = {
  language: "Solidity",
  sources: { "PlayProof.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] },
    },
  },
};

console.log("Compiling PlayProof.sol …");
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  let fatal = false;
  for (const e of output.errors) {
    console.error(e.formattedMessage);
    if (e.severity === "error") fatal = true;
  }
  if (fatal) {
    console.error("Compilation failed.");
    process.exit(1);
  }
}

const contract = output.contracts["PlayProof.sol"].PlayProof;
const artifact = {
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
};

const outDir = path.join(root, "src", "contracts");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "PlayProof.json");
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));

console.log(`✓ Wrote ${path.relative(root, outPath)} (${artifact.abi.length} ABI entries)`);

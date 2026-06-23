import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { OG } from "@/lib/config";

export const dynamic = "force-dynamic";

// Serves the local chain's funded test accounts so the in-app "burner wallet"
// demo mode can sign transactions WITHOUT MetaMask. Hard-gated to local dev
// chains — it refuses to expose keys when pointed at a real network (0G), and
// only ever returns the well-known public Hardhat/Anvil test keys ganache funds.
export async function GET() {
  const isLocal =
    /127\.0\.0\.1|localhost/.test(OG.rpc) || OG.chainIdDec === 31337 || OG.chainIdDec === 1337;
  if (!isLocal) {
    return NextResponse.json(
      { ok: false, enabled: false, error: "Burner mode is disabled on non-local networks." },
      { status: 200 }
    );
  }

  const p = path.join(process.cwd(), "data", "local-accounts.json");
  if (!fs.existsSync(p)) {
    return NextResponse.json({ ok: false, enabled: false, error: "No local accounts found." }, { status: 200 });
  }

  try {
    const accounts = JSON.parse(fs.readFileSync(p, "utf8")) as { address: string; privateKey: string }[];
    // Account 0 is the oracle/treasury — keep it out of the user-facing roster.
    const roster = accounts.slice(1, 6).map((a, i) => ({
      address: a.address,
      privateKey: a.privateKey,
      label: `Demo wallet ${i + 1}`,
    }));
    return NextResponse.json({ ok: true, enabled: true, accounts: roster });
  } catch (e: any) {
    return NextResponse.json({ ok: false, enabled: false, error: e?.message ?? String(e) }, { status: 200 });
  }
}

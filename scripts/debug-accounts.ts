import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });
import { Connection, PublicKey } from "@solana/web3.js";
import PLAYER_MINTS from "../app/lib/player-mints.json" with { type: "json" };

const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");
const conn = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const mints = PLAYER_MINTS as Record<string, string>;
const mint = new PublicKey(mints["Player_NJ"]);

const bondingCurve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], PROGRAM_ID)[0];
const statsOracle = PublicKey.findProgramAddressSync([Buffer.from("stats-oracle"), mint.toBuffer()], PROGRAM_ID)[0];
const exitTreasury = PublicKey.findProgramAddressSync([Buffer.from("exit-treasury")], PROGRAM_ID)[0];
const marketStatus = PublicKey.findProgramAddressSync([Buffer.from("market-status"), mint.toBuffer()], PROGRAM_ID)[0];
const sharpLeaderboard = PublicKey.findProgramAddressSync([Buffer.from("leaderboard"), Buffer.from([1])], PROGRAM_ID)[0];

async function main() {
  console.log("Mint:", mint.toString());
  for (const [name, pk] of [
    ["BondingCurve", bondingCurve],
    ["StatsOracle", statsOracle],
    ["ExitTreasury", exitTreasury],
    ["MarketStatus", marketStatus],
    ["SharpLeaderboard", sharpLeaderboard],
  ] as [string, PublicKey][]) {
    const info = await conn.getAccountInfo(pk);
    console.log(`${name} (${pk.toString().slice(0,12)}...): ${info ? "EXISTS (" + info.data.length + " bytes, owner=" + info.owner.toString().slice(0,12) + ")" : "MISSING"}`);
  }
}
main();

import mongoose from "mongoose";
import { MONGODB_URI } from "../config.js";
import { User } from "./models/User.js";
import { Wallet } from "./models/Wallet.js";
import { Position } from "./models/Position.js";

const COLLECTIONS = ["users", "wallets", "positions"];

/**
 * Drops all app collections (users, wallets, positions).
 * Use this to wipe DB data and schema; next run will recreate empty collections.
 */
export async function dropAllCollections(): Promise<void> {
  const conn = await mongoose.connect(MONGODB_URI);
  const db = conn.connection.db;
  if (!db) throw new Error("No database");

  for (const name of COLLECTIONS) {
    try {
      await db.dropCollection(name);
      console.log("Dropped collection:", name);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code: number }).code === 26) {
        // namespace not found = collection didn't exist
        console.log("Collection did not exist:", name);
      } else {
        throw e;
      }
    }
  }
}

/**
 * Drops the entire database (all collections in the DB pointed by MONGODB_URI).
 */
export async function dropDatabase(): Promise<void> {
  const conn = await mongoose.connect(MONGODB_URI);
  const db = conn.connection.db;
  if (!db) throw new Error("No database");
  await db.dropDatabase();
  console.log("Database dropped.");
}

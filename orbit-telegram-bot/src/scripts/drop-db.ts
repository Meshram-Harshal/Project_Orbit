/**
 * Run: npm run db:reset
 * Drops all app collections (users, wallets, positions). Data and schema are wiped.
 */
import "dotenv/config";
import { dropAllCollections } from "../db/reset.js";

dropAllCollections()
  .then(() => {
    console.log("Done. Restart the bot to use a fresh DB.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

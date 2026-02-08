import "dotenv/config";
import { Bot } from "grammy";
import { connectDb } from "./db/connection.js";
import { registerHandlers } from "./bot/handlers.js";
import { startRebalanceCron } from "./services/rebalanceCron.js";
import { BOT_TOKEN } from "./config.js";
import type { SessionData } from "./bot/session.js";

async function main() {
  await connectDb();
  console.log("MongoDB connected");

  const bot = new Bot<{ session?: SessionData }>(BOT_TOKEN);

  bot.catch((err) => {
    const msg = String(err.error?.message ?? err);
    if (msg.includes("message is not modified") || msg.includes("exactly the same")) return;
    console.error("Bot error:", msg);
  });

  registerHandlers(bot);

  startRebalanceCron();

  await bot.start({
    onStart: (info) => console.log(`Bot @${info.username} started`),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

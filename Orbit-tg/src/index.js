const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { connectDB } = require('./db/connection');
const { registerCommands } = require('./bot/commands');
const { registerCallbacks } = require('./bot/callbacks');
const { monitorIncoming } = require('./services/blockchain');
const { startRebalanceCron, stopRebalanceCron } = require('./services/rebalanceCron');
const User = require('./db/models/User');
const logger = require('./utils/logger');

async function main() {
  // Connect to MongoDB
  await connectDB(config.MONGODB_URI);

  // Initialize bot in polling mode
  const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });

  // Register command and callback handlers
  registerCommands(bot);
  registerCallbacks(bot);

  // Start monitoring incoming transfers for all existing users
  try {
    const users = await User.find({});
    for (const user of users) {
      // Use telegramId as chatId for private messages
      monitorIncoming(bot, user.telegramId, user.walletAddress, user.telegramId);
    }
    if (users.length > 0) {
      logger.info(`Monitoring incoming transfers for ${users.length} existing users`);
    }
  } catch (err) {
    logger.error('Error starting transfer monitors:', err);
  }

  startRebalanceCron();

  logger.info('Orbit Wallet Bot is running');

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down...`);
    stopRebalanceCron();
    bot.stopPolling();
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});

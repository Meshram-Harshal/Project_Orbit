const { isAllowed } = require('../utils/rateLimit');
const { createWallet, exportWallet, getUser } = require('../services/wallet');
const { getBalance, sendNative } = require('../services/blockchain');
const logger = require('../utils/logger');

function registerCommands(bot) {
  // /start command
  bot.onText(/\/start/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (!isAllowed(msg.from.id)) return;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔐 Create Wallet', callback_data: 'create_wallet' },
            { text: '📥 Import Wallet', callback_data: 'import_wallet' },
          ],
          [
            { text: '📤 Export Wallet', callback_data: 'export_wallet' },
            { text: '💰 Balance', callback_data: 'balance' },
          ],
          [
            { text: '💸 Send Tokens', callback_data: 'send_tokens' },
            { text: '📈 Open Position', callback_data: 'open_position' },
          ],
          [{ text: '📉 Close Position', callback_data: 'close_position' }],
        ],
      },
    };

    bot.sendMessage(
      msg.chat.id,
      `Welcome to *Orbit Wallet Bot* 🌐\n\n` +
        `Your custodial wallet on *Monad*.\n\n` +
        `Choose an option below:`,
      { parse_mode: 'Markdown', ...keyboard }
    );
  });

  // /balance command
  bot.onText(/\/balance/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (!isAllowed(msg.from.id)) return;

    const telegramId = String(msg.from.id);

    try {
      const user = await getUser(telegramId);
      if (!user) {
        return bot.sendMessage(
          msg.chat.id,
          'No wallet found. Use /start to create or import one.'
        );
      }

      const balance = await getBalance(user.walletAddress);
      bot.sendMessage(
        msg.chat.id,
        `💰 *Wallet Balance*\n\n` +
          `Address: \`${user.walletAddress}\`\n` +
          `Balance: *${balance} MON*`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error('Balance command error:', err);
      bot.sendMessage(msg.chat.id, 'Error fetching balance. Try again later.');
    }
  });

  // /send <address> <amount> command
  bot.onText(/\/send(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
    if (msg.chat.type !== 'private') return;
    if (!isAllowed(msg.from.id)) return;

    const telegramId = String(msg.from.id);
    const toAddress = match?.[1];
    const amount = match?.[2];

    if (!toAddress || !amount) {
      return bot.sendMessage(
        msg.chat.id,
        'Usage: `/send <address> <amount>`\n\nExample: `/send 0x123...abc 0.1`',
        { parse_mode: 'Markdown' }
      );
    }

    try {
      const sent = await bot.sendMessage(
        msg.chat.id,
        '⏳ Sending transaction...'
      );

      const txHash = await sendNative(telegramId, toAddress, amount);

      bot.editMessageText(
        `✅ *Transaction Sent*\n\n` +
          `To: \`${toAddress}\`\n` +
          `Amount: *${amount} MON*\n` +
          `Tx Hash: \`${txHash}\``,
        {
          chat_id: msg.chat.id,
          message_id: sent.message_id,
          parse_mode: 'Markdown',
        }
      );
    } catch (err) {
      logger.error('Send command error:', err);
      bot.sendMessage(msg.chat.id, `❌ Send failed: ${err.message}`);
    }
  });

  // /export command
  bot.onText(/\/export/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (!isAllowed(msg.from.id)) return;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Yes, show my private key', callback_data: 'confirm_export' },
            { text: '❌ Cancel', callback_data: 'cancel_export' },
          ],
        ],
      },
    };

    bot.sendMessage(
      msg.chat.id,
      '⚠️ *Warning*: Your private key will be displayed and auto-deleted after 60 seconds.\n\n' +
        'Are you sure you want to export?',
      { parse_mode: 'Markdown', ...keyboard }
    );
  });
}

module.exports = { registerCommands };

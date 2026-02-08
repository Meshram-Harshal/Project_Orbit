const { ethers } = require('ethers');
const { isAllowed } = require('../utils/rateLimit');
const { createWallet, importWallet, exportWallet, getUser } = require('../services/wallet');
const { getBalance, getTokenBalance, sendNative, sendToken } = require('../services/blockchain');
const logger = require('../utils/logger');

// Track users in multi-step flows: telegramId -> { state, data }
const userStates = new Map();

function registerCallbacks(bot) {
  bot.on('callback_query', async (query) => {
    if (!isAllowed(query.from.id)) {
      return bot.answerCallbackQuery(query.id, {
        text: 'Rate limited. Please wait.',
      });
    }

    const chatId = query.message.chat.id;
    const telegramId = String(query.from.id);
    const action = query.data;

    await bot.answerCallbackQuery(query.id);

    try {
      switch (action) {
        case 'create_wallet':
          await handleCreateWallet(bot, chatId, telegramId);
          break;
        case 'import_wallet':
          await handleImportWalletStart(bot, chatId, telegramId);
          break;
        case 'export_wallet':
          await handleExportPrompt(bot, chatId);
          break;
        case 'confirm_export':
          await handleExportConfirm(bot, chatId, telegramId);
          break;
        case 'cancel_export':
          bot.sendMessage(chatId, 'Export cancelled.');
          break;
        case 'balance':
          await handleBalance(bot, chatId, telegramId);
          break;
        case 'send_tokens':
          await handleSendStart(bot, chatId, telegramId);
          break;
        case 'send_native':
          await handleSendNativeStart(bot, chatId, telegramId);
          break;
        case 'send_erc20':
          await handleSendERC20Start(bot, chatId, telegramId);
          break;
      }
    } catch (err) {
      logger.error(`Callback error [${action}]:`, err);
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  // Handle text messages for multi-step flows
  bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (!msg.text || msg.text.startsWith('/')) return;
    if (!isAllowed(msg.from.id)) return;

    const telegramId = String(msg.from.id);
    const state = userStates.get(telegramId);
    if (!state) return;

    try {
      switch (state.step) {
        case 'import_waiting_key':
          await handleImportKey(bot, msg, telegramId);
          break;
        case 'send_native_address':
          await handleSendNativeAddress(bot, msg, telegramId);
          break;
        case 'send_native_amount':
          await handleSendNativeAmount(bot, msg, telegramId);
          break;
        case 'send_erc20_token':
          await handleSendERC20Token(bot, msg, telegramId);
          break;
        case 'send_erc20_address':
          await handleSendERC20Address(bot, msg, telegramId);
          break;
        case 'send_erc20_amount':
          await handleSendERC20Amount(bot, msg, telegramId);
          break;
      }
    } catch (err) {
      logger.error('Message flow error:', err);
      bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
      userStates.delete(telegramId);
    }
  });
}

// --- Create Wallet ---
async function handleCreateWallet(bot, chatId, telegramId) {
  const result = await createWallet(telegramId);

  if (result.alreadyExists) {
    return bot.sendMessage(
      chatId,
      `You already have a wallet:\n\`${result.address}\`\n\nUse Export to view your private key.`,
      { parse_mode: 'Markdown' }
    );
  }

  bot.sendMessage(
    chatId,
    `✅ *Wallet Created*\n\nAddress: \`${result.address}\`\n\n` +
      `Send MON to this address to fund your wallet.`,
    { parse_mode: 'Markdown' }
  );
}

// --- Import Wallet ---
async function handleImportWalletStart(bot, chatId, telegramId) {
  const existing = await getUser(telegramId);
  if (existing) {
    return bot.sendMessage(
      chatId,
      'You already have a wallet. Export and contact support if you need to replace it.'
    );
  }

  userStates.set(telegramId, { step: 'import_waiting_key' });

  bot.sendMessage(
    chatId,
    '📥 *Import Wallet*\n\n' +
      'Send your private key or mnemonic phrase.\n\n' +
      '⚠️ Your message will be deleted immediately for security.',
    { parse_mode: 'Markdown' }
  );
}

async function handleImportKey(bot, msg, telegramId) {
  const chatId = msg.chat.id;

  // Delete the message containing the private key immediately
  try {
    await bot.deleteMessage(chatId, msg.message_id);
  } catch {
    // May fail if bot doesn't have delete permissions
  }

  userStates.delete(telegramId);

  const address = await importWallet(telegramId, msg.text);

  bot.sendMessage(
    chatId,
    `✅ *Wallet Imported*\n\nAddress: \`${address}\``,
    { parse_mode: 'Markdown' }
  );
}

// --- Export Wallet ---
async function handleExportPrompt(bot, chatId) {
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
    chatId,
    '⚠️ *Warning*: Your private key will be displayed and auto-deleted after 60 seconds.\n\n' +
      'Are you sure you want to export?',
    { parse_mode: 'Markdown', ...keyboard }
  );
}

async function handleExportConfirm(bot, chatId, telegramId) {
  const { privateKey, address } = await exportWallet(telegramId);

  const sent = await bot.sendMessage(
    chatId,
    `🔑 *Private Key (auto-deletes in 60s)*\n\n` +
      `Address: \`${address}\`\n` +
      `Key: \`${privateKey}\`\n\n` +
      `⚠️ Store this securely. Never share it.`,
    { parse_mode: 'Markdown' }
  );

  // Auto-delete after 60 seconds
  setTimeout(async () => {
    try {
      await bot.deleteMessage(chatId, sent.message_id);
      bot.sendMessage(chatId, '🗑️ Private key message has been deleted for security.');
    } catch {
      // Message may have been deleted manually
    }
  }, 60_000);
}

// --- Balance ---
async function handleBalance(bot, chatId, telegramId) {
  const user = await getUser(telegramId);
  if (!user) {
    return bot.sendMessage(
      chatId,
      'No wallet found. Create or import one first.'
    );
  }

  const balance = await getBalance(user.walletAddress);

  bot.sendMessage(
    chatId,
    `💰 *Wallet Balance*\n\n` +
      `Address: \`${user.walletAddress}\`\n` +
      `Balance: *${balance} MON*`,
    { parse_mode: 'Markdown' }
  );
}

// --- Send Tokens ---
async function handleSendStart(bot, chatId, telegramId) {
  const user = await getUser(telegramId);
  if (!user) {
    return bot.sendMessage(
      chatId,
      'No wallet found. Create or import one first.'
    );
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🪙 Native (MON)', callback_data: 'send_native' },
          { text: '🎨 ERC-20 Token', callback_data: 'send_erc20' },
        ],
      ],
    },
  };

  bot.sendMessage(chatId, 'What would you like to send?', keyboard);
}

// --- Send Native ---
async function handleSendNativeStart(bot, chatId, telegramId) {
  userStates.set(telegramId, { step: 'send_native_address' });
  bot.sendMessage(chatId, '📮 Enter the recipient address:');
}

async function handleSendNativeAddress(bot, msg, telegramId) {
  const address = msg.text.trim();
  if (!ethers.isAddress(address)) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid address. Try again:');
  }

  userStates.set(telegramId, {
    step: 'send_native_amount',
    toAddress: address,
  });
  bot.sendMessage(msg.chat.id, '💰 Enter the amount (in MON):');
}

async function handleSendNativeAmount(bot, msg, telegramId) {
  const state = userStates.get(telegramId);
  const amount = msg.text.trim();

  try {
    ethers.parseEther(amount);
  } catch {
    return bot.sendMessage(msg.chat.id, '❌ Invalid amount. Try again:');
  }

  userStates.delete(telegramId);

  const sent = await bot.sendMessage(msg.chat.id, '⏳ Sending transaction...');

  const txHash = await sendNative(telegramId, state.toAddress, amount);

  bot.editMessageText(
    `✅ *Transaction Sent*\n\n` +
      `To: \`${state.toAddress}\`\n` +
      `Amount: *${amount} MON*\n` +
      `Tx Hash: \`${txHash}\``,
    {
      chat_id: msg.chat.id,
      message_id: sent.message_id,
      parse_mode: 'Markdown',
    }
  );
}

// --- Send ERC-20 ---
async function handleSendERC20Start(bot, chatId, telegramId) {
  userStates.set(telegramId, { step: 'send_erc20_token' });
  bot.sendMessage(chatId, '📋 Enter the token contract address:');
}

async function handleSendERC20Token(bot, msg, telegramId) {
  const tokenAddress = msg.text.trim();
  if (!ethers.isAddress(tokenAddress)) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid token address. Try again:');
  }

  userStates.set(telegramId, {
    step: 'send_erc20_address',
    tokenAddress,
  });
  bot.sendMessage(msg.chat.id, '📮 Enter the recipient address:');
}

async function handleSendERC20Address(bot, msg, telegramId) {
  const state = userStates.get(telegramId);
  const address = msg.text.trim();
  if (!ethers.isAddress(address)) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid address. Try again:');
  }

  userStates.set(telegramId, {
    ...state,
    step: 'send_erc20_amount',
    toAddress: address,
  });
  bot.sendMessage(msg.chat.id, '💰 Enter the amount to send:');
}

async function handleSendERC20Amount(bot, msg, telegramId) {
  const state = userStates.get(telegramId);
  const amount = msg.text.trim();

  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid amount. Try again:');
  }

  userStates.delete(telegramId);

  const sent = await bot.sendMessage(msg.chat.id, '⏳ Sending token transaction...');

  const txHash = await sendToken(
    telegramId,
    state.toAddress,
    state.tokenAddress,
    amount
  );

  bot.editMessageText(
    `✅ *Token Transfer Sent*\n\n` +
      `Token: \`${state.tokenAddress}\`\n` +
      `To: \`${state.toAddress}\`\n` +
      `Amount: *${amount}*\n` +
      `Tx Hash: \`${txHash}\``,
    {
      chat_id: msg.chat.id,
      message_id: sent.message_id,
      parse_mode: 'Markdown',
    }
  );
}

module.exports = { registerCallbacks };

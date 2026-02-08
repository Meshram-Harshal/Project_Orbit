const { ethers } = require('ethers');
const User = require('../db/models/User');
const { encrypt, decrypt } = require('./crypto');
const config = require('../config');
const logger = require('../utils/logger');

async function createWallet(telegramId) {
  const existing = await User.findOne({ telegramId });
  if (existing) {
    return { address: existing.walletAddress, alreadyExists: true };
  }

  const wallet = ethers.Wallet.createRandom();
  const encrypted = encrypt(wallet.privateKey, config.ENCRYPTION_KEY);

  await User.create({
    telegramId,
    walletAddress: wallet.address,
    encryptedPrivateKey: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    salt: encrypted.salt,
  });

  logger.info(`Wallet created for user ${telegramId}: ${wallet.address}`);
  return { address: wallet.address, alreadyExists: false };
}

async function importWallet(telegramId, input) {
  const existing = await User.findOne({ telegramId });
  if (existing) {
    throw new Error('You already have a wallet. Export and delete first if you want to import a new one.');
  }

  let wallet;
  const trimmed = input.trim();

  // Check if it's a mnemonic (multiple words)
  if (trimmed.includes(' ')) {
    try {
      wallet = ethers.Wallet.fromPhrase(trimmed);
    } catch {
      throw new Error('Invalid mnemonic phrase.');
    }
  } else {
    // Treat as private key
    try {
      const key = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
      wallet = new ethers.Wallet(key);
    } catch {
      throw new Error('Invalid private key.');
    }
  }

  const encrypted = encrypt(wallet.privateKey, config.ENCRYPTION_KEY);

  await User.create({
    telegramId,
    walletAddress: wallet.address,
    encryptedPrivateKey: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    salt: encrypted.salt,
  });

  logger.info(`Wallet imported for user ${telegramId}: ${wallet.address}`);
  return wallet.address;
}

async function exportWallet(telegramId) {
  const user = await User.findOne({ telegramId });
  if (!user) {
    throw new Error('No wallet found. Create or import one first.');
  }

  const privateKey = decrypt(
    {
      ciphertext: user.encryptedPrivateKey,
      iv: user.iv,
      authTag: user.authTag,
      salt: user.salt,
    },
    config.ENCRYPTION_KEY
  );

  logger.info(`Wallet exported for user ${telegramId}`);
  return { privateKey, address: user.walletAddress };
}

async function getUser(telegramId) {
  return User.findOne({ telegramId });
}

module.exports = { createWallet, importWallet, exportWallet, getUser };

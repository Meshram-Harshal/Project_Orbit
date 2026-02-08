const { ethers } = require('ethers');
const config = require('../config');
const { decrypt } = require('./crypto');
const User = require('../db/models/User');
const Transaction = require('../db/models/Transaction');
const logger = require('../utils/logger');

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

let provider;

function getProvider() {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.RPC_URL, config.CHAIN_ID);
  }
  return provider;
}

function getSigner(privateKey) {
  return new ethers.Wallet(privateKey, getProvider());
}

async function getBalance(address) {
  const balance = await getProvider().getBalance(address);
  return ethers.formatEther(balance);
}

async function getTokenBalance(address, tokenAddress) {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, getProvider());
  const [balance, decimals, symbol] = await Promise.all([
    contract.balanceOf(address),
    contract.decimals(),
    contract.symbol(),
  ]);
  return {
    balance: ethers.formatUnits(balance, decimals),
    symbol,
    decimals,
  };
}

async function sendNative(telegramId, toAddress, amount) {
  const user = await User.findOne({ telegramId });
  if (!user) throw new Error('No wallet found.');

  if (!ethers.isAddress(toAddress)) {
    throw new Error('Invalid recipient address.');
  }

  const parsedAmount = ethers.parseEther(amount);
  if (parsedAmount <= 0n) {
    throw new Error('Amount must be greater than 0.');
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

  const signer = getSigner(privateKey);

  const tx = await signer.sendTransaction({
    to: toAddress,
    value: parsedAmount,
  });

  const txRecord = await Transaction.create({
    userId: user._id,
    toAddress,
    amount,
    tokenAddress: null,
    txHash: tx.hash,
    status: 'pending',
  });

  logger.info(`Native send tx ${tx.hash} from user ${telegramId}`);

  // Wait for confirmation in background
  tx.wait()
    .then(async (receipt) => {
      const status = receipt.status === 1 ? 'confirmed' : 'failed';
      await Transaction.findByIdAndUpdate(txRecord._id, { status });
      logger.info(`Tx ${tx.hash} ${status}`);
    })
    .catch(async (err) => {
      await Transaction.findByIdAndUpdate(txRecord._id, { status: 'failed' });
      logger.error(`Tx ${tx.hash} failed:`, err);
    });

  return tx.hash;
}

async function sendToken(telegramId, toAddress, tokenAddress, amount) {
  const user = await User.findOne({ telegramId });
  if (!user) throw new Error('No wallet found.');

  if (!ethers.isAddress(toAddress)) {
    throw new Error('Invalid recipient address.');
  }
  if (!ethers.isAddress(tokenAddress)) {
    throw new Error('Invalid token contract address.');
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

  const signer = getSigner(privateKey);
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

  const decimals = await contract.decimals();
  const parsedAmount = ethers.parseUnits(amount, decimals);

  if (parsedAmount <= 0n) {
    throw new Error('Amount must be greater than 0.');
  }

  const tx = await contract.transfer(toAddress, parsedAmount);

  const txRecord = await Transaction.create({
    userId: user._id,
    toAddress,
    amount,
    tokenAddress,
    txHash: tx.hash,
    status: 'pending',
  });

  logger.info(`Token send tx ${tx.hash} from user ${telegramId}`);

  tx.wait()
    .then(async (receipt) => {
      const status = receipt.status === 1 ? 'confirmed' : 'failed';
      await Transaction.findByIdAndUpdate(txRecord._id, { status });
      logger.info(`Tx ${tx.hash} ${status}`);
    })
    .catch(async (err) => {
      await Transaction.findByIdAndUpdate(txRecord._id, { status: 'failed' });
      logger.error(`Tx ${tx.hash} failed:`, err);
    });

  return tx.hash;
}

async function monitorIncoming(bot, telegramId, address, chatId) {
  const p = getProvider();

  p.on('block', async (blockNumber) => {
    try {
      const block = await p.getBlock(blockNumber, true);
      if (!block || !block.prefetchedTransactions) return;

      for (const tx of block.prefetchedTransactions) {
        if (tx.to && tx.to.toLowerCase() === address.toLowerCase()) {
          const value = ethers.formatEther(tx.value);
          bot.sendMessage(
            chatId,
            `💰 *Incoming Transfer Detected*\n\n` +
              `From: \`${tx.from}\`\n` +
              `Amount: ${value} MON\n` +
              `Tx: \`${tx.hash}\``,
            { parse_mode: 'Markdown' }
          );
        }
      }
    } catch (err) {
      logger.error(`Block monitor error at block ${blockNumber}:`, err);
    }
  });

  logger.info(`Monitoring incoming transfers for ${address}`);
}

module.exports = {
  getBalance,
  getTokenBalance,
  sendNative,
  sendToken,
  monitorIncoming,
  getProvider,
};

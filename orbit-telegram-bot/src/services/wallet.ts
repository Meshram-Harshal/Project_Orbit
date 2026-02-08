import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Wallet } from "../db/models/Wallet.js";
import { User } from "../db/models/User.js";
import { CHAIN_ID } from "../config.js";
import type { mongoose } from "mongoose";

export function createNewWallet(): { address: string; privateKey: `0x${string}` } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey };
}

export async function saveWallet(
  userId: mongoose.Types.ObjectId,
  address: string,
  privateKey: string,
  isCustodial: boolean
): Promise<mongoose.Types.ObjectId> {
  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const w = await Wallet.create({
    userId,
    address,
    privateKey: pk,
    isCustodial,
    chainId: CHAIN_ID,
  });
  return w._id;
}

/** Get private key from DB (stored in plain text). Use for rebalance, withdraw, redeposit. */
export async function getPrivateKey(walletId: mongoose.Types.ObjectId): Promise<`0x${string}`> {
  const w = await Wallet.findById(walletId).orFail();
  const pk = w.privateKey.startsWith("0x") ? w.privateKey : `0x${w.privateKey}`;
  return pk as `0x${string}`;
}

export async function getOrCreateUser(telegramId: number): Promise<mongoose.Types.ObjectId> {
  let user = await User.findOne({ telegramId });
  if (!user) {
    user = await User.create({ telegramId });
  }
  return user._id;
}

export async function getWalletByUserId(userId: mongoose.Types.ObjectId) {
  return Wallet.findOne({ userId }).sort({ createdAt: -1 });
}

export async function getWalletById(walletId: mongoose.Types.ObjectId) {
  return Wallet.findById(walletId).orFail();
}

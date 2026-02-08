import { Position } from "../db/models/Position.js";
import { getPrivateKey } from "./wallet.js";
import { createPublicClient } from "./blockchain.js";
import { getPoolKey, getCurrentTick } from "./blockchain.js";
import { POSITION_MANAGER_ABI } from "./blockchain.js";
import { decodePositionInfo } from "../lib/position.js";
import { depositSingleSidedMon, depositSingleSidedAusd, burnPosition } from "./lpService.js";
import { AUSD_ADDRESS, POSITION_MANAGER } from "../config.js";
import { ERC20_ABI } from "../lib/abis.js";
import type { mongoose } from "mongoose";

export async function createPosition(
  walletId: mongoose.Types.ObjectId,
  pair: string,
  tokenId: string,
  tickLower: number,
  tickUpper: number,
  tickRange: number,
  initialAmountWei: string
): Promise<mongoose.Types.ObjectId> {
  const pos = await Position.create({
    walletId,
    pair,
    tokenId,
    tickLower,
    tickUpper,
    tickRange,
    status: "active",
    totalFeeEarnedWei: "0",
    initialAmountWei,
  });
  return pos._id;
}

export async function updatePositionAfterRebalance(
  positionId: mongoose.Types.ObjectId,
  tokenId: string,
  tickLower: number,
  tickUpper: number,
  feeEarnedWeiDelta: string
): Promise<void> {
  const pos = await Position.findById(positionId).orFail();
  const newTotal = (BigInt(pos.totalFeeEarnedWei) + BigInt(feeEarnedWeiDelta)).toString();
  await Position.updateOne(
    { _id: positionId },
    {
      $set: {
        tokenId,
        tickLower,
        tickUpper,
        totalFeeEarnedWei: newTotal,
        updatedAt: new Date(),
      },
    }
  );
}

export async function closePosition(positionId: mongoose.Types.ObjectId): Promise<void> {
  await Position.updateOne(
    { _id: positionId },
    { $set: { status: "closed", updatedAt: new Date() } }
  );
}

export async function getActivePositionsForUser(walletId: mongoose.Types.ObjectId) {
  return Position.find({ walletId, status: "active" }).sort({ createdAt: -1 });
}

export async function getActivePositionsForWallet(walletId: mongoose.Types.ObjectId) {
  return Position.find({ walletId, status: "active" });
}

export async function getAllActivePositions() {
  return Position.find({ status: "active" }).populate("walletId");
}

export async function getPositionById(positionId: mongoose.Types.ObjectId | string) {
  return Position.findById(positionId).populate("walletId").orFail();
}

/** Check one position: if out of range, burn and redeposit; update DB. Returns true if rebalanced. */
export async function checkAndRebalancePosition(pos: {
  _id: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  tokenId: string;
  tickLower: number;
  tickUpper: number;
  tickRange: number;
  totalFeeEarnedWei: string;
}): Promise<{ rebalanced: boolean; error?: string }> {
  const publicClient = createPublicClient();
  const { poolId } = getPoolKey();

  const tickNow = await getCurrentTick(publicClient, poolId);
  const posTickLower = pos.tickLower;
  const posTickUpper = pos.tickUpper;
  const inRange = tickNow >= posTickLower && tickNow <= posTickUpper;

  if (inRange) return { rebalanced: false };

  const walletId = typeof pos.walletId === "object" && pos.walletId && "_id" in pos.walletId
    ? (pos.walletId as { _id: mongoose.Types.ObjectId })._id
    : (pos.walletId as mongoose.Types.ObjectId);
  const privateKey = await getPrivateKey(walletId);
  const account = (await import("viem/accounts")).privateKeyToAccount(privateKey);

  const monBefore = await publicClient.getBalance({ address: account.address });
  const ausdBefore = (await publicClient.readContract({
    address: AUSD_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  let burnGasUsed: bigint;
  try {
    const result = await burnPosition(privateKey, BigInt(pos.tokenId));
    burnGasUsed = result.gasUsed;
  } catch (e) {
    return { rebalanced: false, error: e instanceof Error ? e.message : String(e) };
  }

  const monAfter = await publicClient.getBalance({ address: account.address });
  const ausdAfter = (await publicClient.readContract({
    address: AUSD_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  const withdrawnMon = monAfter - monBefore + burnGasUsed;
  const withdrawnAusd = ausdAfter - ausdBefore;

  const tickRange = pos.tickRange;
  let newTokenId: string;
  let newTickLower: number;
  let newTickUpper: number;
  let feeDelta = "0";

  if (tickNow > posTickUpper) {
    if (withdrawnAusd === 0n) {
      return { rebalanced: false, error: "Burned but no AUSD received" };
    }
    newTickLower = tickNow - tickRange;
    newTickUpper = tickNow - 1;
    await depositSingleSidedAusd(privateKey, withdrawnAusd, {
      tickLower: newTickLower,
      tickUpper: newTickUpper,
      exactAmount: true,
    });
    const nextId = (await publicClient.readContract({
      address: POSITION_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI,
      functionName: "nextTokenId",
    })) as bigint;
    newTokenId = (nextId - 1n).toString();
  } else {
    if (withdrawnMon === 0n) {
      return { rebalanced: false, error: "Burned but no MON received" };
    }
    newTickLower = tickNow + 1;
    newTickUpper = tickNow + tickRange;
    // Reserve gas for the mint tx so we don't send entire balance as value (reference: Orbit)
    const gasReserveWei = 500000n * 30n * 10n ** 9n; // ~0.015 MON at 30 gwei
    const depositMon = withdrawnMon > gasReserveWei ? withdrawnMon - gasReserveWei : withdrawnMon;
    await depositSingleSidedMon(privateKey, newTickLower, newTickUpper, depositMon, { exactAmount: true });
    const nextId = (await publicClient.readContract({
      address: POSITION_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI,
      functionName: "nextTokenId",
    })) as bigint;
    newTokenId = (nextId - 1n).toString();
  }

  await updatePositionAfterRebalance(pos._id, newTokenId, newTickLower, newTickUpper, feeDelta);
  return { rebalanced: true };
}

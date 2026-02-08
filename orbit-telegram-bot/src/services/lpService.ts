import {
  encodeAbiParameters,
  parseAbiParameters,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  POSITION_MANAGER,
  PERMIT2,
  MON_ADDRESS,
  AUSD_ADDRESS,
  FEE,
  TICK_SPACING,
  HOOKS,
  SLIPPAGE_BPS,
} from "../config.js";
import { getPoolId, getSqrtRatioAtTick, getLiquidityForAmount0, getLiquidityForAmount1 } from "../lib/poolMath.js";
import {
  POSITION_MANAGER_ABI,
  ERC20_ABI,
  PERMIT2_ABI,
  MINT_POSITION,
  SETTLE_PAIR,
  SWEEP,
  BURN_POSITION,
  TAKE_PAIR,
} from "../lib/abis.js";
import {
  monadChain,
  getPoolKey,
  getCurrentTick,
  createPublicClient,
  getWalletClient,
} from "./blockchain.js";

/** When true, use exact monAmountWei for amount0Max/value (for rebalance when wallet has exactly that amount). */
export async function depositSingleSidedMon(
  privateKey: `0x${string}`,
  tickLower: number,
  tickUpper: number,
  monAmountWei: bigint,
  opts?: { exactAmount?: boolean }
): Promise<void> {
  const publicClient = createPublicClient();
  const walletClient = getWalletClient(privateKey);
  const account = privateKeyToAccount(privateKey);
  const { currency0, currency1, poolId } = getPoolKey();

  const currentTick = await getCurrentTick(publicClient, poolId);
  if (currentTick >= tickLower) {
    throw new Error(
      `Single-sided MON requires range above current price. currentTick=${currentTick}, tickLower=${tickLower}`
    );
  }

  const amount0Max = opts?.exactAmount
    ? monAmountWei
    : (monAmountWei * (10000n + BigInt(SLIPPAGE_BPS))) / 10000n;
  const amount1Max = 0n;
  const sqrtRatioLower = getSqrtRatioAtTick(tickLower);
  const sqrtRatioUpper = getSqrtRatioAtTick(tickUpper);
  const liquidity = getLiquidityForAmount0(sqrtRatioLower, sqrtRatioUpper, monAmountWei);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const poolKey = {
    currency0,
    currency1,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    hooks: HOOKS as `0x${string}`,
  };

  const mintParams = encodeAbiParameters(
    parseAbiParameters(
      "(address, address, uint24, int24, address), int24, int24, uint256, uint128, uint128, address, bytes"
    ),
    [
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      account.address,
      "0x",
    ]
  );
  const settleParams = encodeAbiParameters(parseAbiParameters("address, address"), [currency0, currency1]);
  const sweepParams = encodeAbiParameters(parseAbiParameters("address, address"), [
    MON_ADDRESS as `0x${string}`,
    account.address,
  ]);

  const actions =
    "0x" +
    [MINT_POSITION, SETTLE_PAIR, SWEEP]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const unlockData = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [
    actions as `0x${string}`,
    [mintParams, settleParams, sweepParams],
  ]);

  const hash = await walletClient.writeContract({
    address: POSITION_MANAGER as `0x${string}`,
    abi: POSITION_MANAGER_ABI,
    functionName: "modifyLiquidities",
    args: [unlockData, deadline],
    value: amount0Max,
    account,
    chain: monadChain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

/** When exactAmount is true, use exact ausdAmountWei for amount1Max (for rebalance). */
export async function depositSingleSidedAusd(
  privateKey: `0x${string}`,
  ausdAmountWei: bigint,
  opts: { tickLower: number; tickUpper: number; exactAmount?: boolean }
): Promise<void> {
  const publicClient = createPublicClient();
  const walletClient = getWalletClient(privateKey);
  const account = privateKeyToAccount(privateKey);
  const { currency0, currency1 } = getPoolKey();

  const tickLower = opts.tickLower;
  const tickUpper = opts.tickUpper;

  const amount0Max = 0n;
  const amount1Max = opts.exactAmount
    ? ausdAmountWei
    : (ausdAmountWei * (10000n + BigInt(SLIPPAGE_BPS))) / 10000n;
  const sqrtRatioLower = getSqrtRatioAtTick(tickLower);
  const sqrtRatioUpper = getSqrtRatioAtTick(tickUpper);
  const liquidity = getLiquidityForAmount1(sqrtRatioLower, sqrtRatioUpper, ausdAmountWei);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const poolKey = {
    currency0,
    currency1,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    hooks: HOOKS as `0x${string}`,
  };

  const mintParams = encodeAbiParameters(
    parseAbiParameters(
      "(address, address, uint24, int24, address), int24, int24, uint256, uint128, uint128, address, bytes"
    ),
    [
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      account.address,
      "0x",
    ]
  );
  const settleParams = encodeAbiParameters(parseAbiParameters("address, address"), [currency0, currency1]);

  const permit2Expiration = 281474976710655n;
  const amount160 = amount1Max > 2n ** 160n - 1n ? 2n ** 160n - 1n : amount1Max;

  const approveHash = await walletClient.writeContract({
    address: AUSD_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [PERMIT2 as `0x${string}`, amount1Max],
    account,
    chain: monadChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const permit2Hash = await walletClient.writeContract({
    address: PERMIT2 as `0x${string}`,
    abi: PERMIT2_ABI,
    functionName: "approve",
    args: [AUSD_ADDRESS as `0x${string}`, POSITION_MANAGER as `0x${string}`, amount160, permit2Expiration],
    account,
    chain: monadChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: permit2Hash });

  const actions =
    "0x" +
    [MINT_POSITION, SETTLE_PAIR]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const unlockData = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [
    actions as `0x${string}`,
    [mintParams, settleParams],
  ]);

  const hash = await walletClient.writeContract({
    address: POSITION_MANAGER as `0x${string}`,
    abi: POSITION_MANAGER_ABI,
    functionName: "modifyLiquidities",
    args: [unlockData, deadline],
    value: 0n,
    account,
    chain: monadChain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function burnPosition(
  privateKey: `0x${string}`,
  tokenId: bigint
): Promise<{ gasUsed: bigint }> {
  const publicClient = createPublicClient();
  const walletClient = getWalletClient(privateKey);
  const account = privateKeyToAccount(privateKey);
  const { currency0, currency1 } = getPoolKey();

  const amount0Min = 0n;
  const amount1Min = 0n;
  const hookData = "0x";

  const burnParams = encodeAbiParameters(
    parseAbiParameters("uint256, uint128, uint128, bytes"),
    [tokenId, amount0Min, amount1Min, hookData as `0x${string}`]
  );
  const takeParams = encodeAbiParameters(parseAbiParameters("address, address, address"), [
    currency0,
    currency1,
    account.address,
  ]);

  const actions =
    "0x" +
    [BURN_POSITION, TAKE_PAIR]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const unlockData = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [
    actions as `0x${string}`,
    [burnParams, takeParams],
  ]);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const hash = await walletClient.writeContract({
    address: POSITION_MANAGER as `0x${string}`,
    abi: POSITION_MANAGER_ABI,
    functionName: "modifyLiquidities",
    args: [unlockData, deadline],
    value: 0n,
    account,
    chain: monadChain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const gasUsed = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
  return { gasUsed };
}

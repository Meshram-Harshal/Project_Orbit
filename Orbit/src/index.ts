/**
 * MON/AUSD single-sided LP keeper:
 * 1) Deposit MON as single-sided LP. You enter MON amount and tick range in the terminal.
 *    Tick range: e.g. 20 → lower = currentTick + 1, upper = currentTick + 20.
 * 2) After 2 minutes, check if position is in range.
 * 3) If in range: do nothing. If not: withdraw and redeposit in range.
 *    - Price above range -> left with AUSD -> redeposit single-sided AUSD.
 *    - Price below range -> left with MON -> redeposit single-sided MON.
 */

import * as readline from "readline";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  parseAbiParameters,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_ID,
  RPC_URL,
  PERMIT2,
  POSITION_MANAGER,
  STATE_VIEW,
  MON_ADDRESS as MON_NATIVE,
  AUSD_ADDRESS,
  FEE,
  TICK_SPACING,
  HOOKS,
  getPrivateKey,
  SLIPPAGE_BPS,
  CHECK_AFTER_SECONDS,
} from "./config.js";
import { getPoolId, getSqrtRatioAtTick, getLiquidityForAmount0, getLiquidityForAmount1 } from "./lib/poolMath.js";
import { decodePositionInfo } from "./lib/position.js";
import {
  STATE_VIEW_ABI,
  POSITION_MANAGER_ABI,
  ERC20_ABI,
  PERMIT2_ABI,
  MINT_POSITION,
  SETTLE_PAIR,
  SWEEP,
  BURN_POSITION,
  TAKE_PAIR,
} from "./lib/abis.js";

const monadChain = {
  id: CHAIN_ID,
  name: "Monad",
  nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" },
  rpcUrls: { default: { http: [RPC_URL] } },
};

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getPoolKey(): {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  poolId: `0x${string}`;
} {
  const [currency0, currency1]: [`0x${string}`, `0x${string}`] =
    BigInt(MON_NATIVE) < BigInt(AUSD_ADDRESS)
      ? [MON_NATIVE as `0x${string}`, AUSD_ADDRESS as `0x${string}`]
      : [AUSD_ADDRESS as `0x${string}`, MON_NATIVE as `0x${string}`];
  const poolId = getPoolId(currency0, currency1, FEE, TICK_SPACING, HOOKS as `0x${string}`);
  return { currency0, currency1, poolId };
}

async function getCurrentTick(publicClient: ReturnType<typeof createPublicClient>, poolId: `0x${string}`): Promise<number> {
  const slot0 = (await publicClient.readContract({
    address: STATE_VIEW as `0x${string}`,
    abi: STATE_VIEW_ABI,
    functionName: "getSlot0",
    args: [poolId],
  })) as readonly [bigint, number, number, number];
  if (slot0[0] === 0n) throw new Error("Pool not found (sqrtPriceX96 is 0).");
  return Number(slot0[1]);
}

/** Mint single-sided MON LP: range must be above current price (token0 = MON in sorted order). */
async function depositSingleSidedMon(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  tickLower: number,
  tickUpper: number,
  monAmountWei: bigint
): Promise<void> {
  const { currency0, currency1, poolId } = getPoolKey();
  const currentTick = await getCurrentTick(publicClient, poolId);
  if (currentTick >= tickLower) {
    throw new Error(
      `Single-sided MON requires range above current price. currentTick=${currentTick}, tickLower=${tickLower}. Use tickLower > currentTick.`
    );
  }

  const amount0Max = (monAmountWei * (10000n + BigInt(SLIPPAGE_BPS))) / 10000n;
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
    MON_NATIVE as `0x${string}`,
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

/** Mint single-sided AUSD LP: range must be below current price. Uses opts.tickLower/tickUpper if provided. */
async function depositSingleSidedAusd(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  ausdAmountWei: bigint,
  opts?: { tickLower: number; tickUpper: number }
): Promise<void> {
  const { currency0, currency1, poolId } = getPoolKey();
  const currentTick = await getCurrentTick(publicClient, poolId);
  const tickLower = opts?.tickLower ?? currentTick - 5;
  const tickUpper = opts?.tickUpper ?? currentTick - 1;

  const amount0Max = 0n;
  const amount1Max = (ausdAmountWei * (10000n + BigInt(SLIPPAGE_BPS))) / 10000n;
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

  console.log("Approving AUSD to Permit2...");
  const approveHash = await walletClient.writeContract({
    address: AUSD_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [PERMIT2 as `0x${string}`, amount1Max],
    account,
    chain: monadChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  console.log("Permit2: approving PositionManager...");
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

/** Burn position and receive tokens to account. Returns receipt so caller can add burn tx gas back when depositing full amount. */
async function burnPosition(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  tokenId: bigint
): Promise<{ gasUsed: bigint }> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const publicClient = createPublicClient({
    chain: monadChain,
    transport: http(RPC_URL),
  });
  const account = privateKeyToAccount(getPrivateKey() as `0x${string}`);
  const walletClient = createWalletClient({
    chain: monadChain,
    transport: http(RPC_URL),
  });

  const { poolId } = getPoolKey();
  const currentTick = await getCurrentTick(publicClient, poolId);
  console.log("Current pool tick:", currentTick);

  const monAmountStr = await ask("Enter MON amount to deposit: ");
  if (!monAmountStr) throw new Error("MON amount is required.");
  const tickRangeStr = await ask("Enter tick range (lower = current+1, upper = current+range, e.g. 20): ");
  if (!tickRangeStr) throw new Error("Tick range is required.");

  const tickRange = parseInt(tickRangeStr, 10);
  if (!Number.isInteger(tickRange) || tickRange < 1) throw new Error("Tick range must be a positive integer (e.g. 20).");

  const tickLower = currentTick + 1;
  const tickUpper = currentTick + tickRange;
  console.log("Computed range: tickLower =", tickLower, ", tickUpper =", tickUpper);
  console.log("MON amount:", monAmountStr);

  const monAmountWei = parseEther(monAmountStr);

  // 1) Deposit single-sided MON; then get the new position's tokenId (nextTokenId - 1 after mint)
  console.log("Depositing single-sided MON LP...");
  await depositSingleSidedMon(publicClient, walletClient, account, tickLower, tickUpper, monAmountWei);
  const nextIdAfter = (await publicClient.readContract({
    address: POSITION_MANAGER as `0x${string}`,
    abi: POSITION_MANAGER_ABI,
    functionName: "nextTokenId",
  })) as bigint;
  let positionTokenId = nextIdAfter - 1n;
  console.log("Minted position tokenId:", positionTokenId.toString());
  console.log("Keeper running indefinitely. Next check in", CHECK_AFTER_SECONDS, "s. Stop with Ctrl+C.\n");

  // Run indefinitely: wait -> check -> if out of range burn and redeposit only withdrawn amount -> repeat
  while (true) {
    console.log(`Waiting ${CHECK_AFTER_SECONDS}s until next range check...`);
    await sleep(CHECK_AFTER_SECONDS * 1000);

    const tickNow = await getCurrentTick(publicClient, poolId);
    const positionInfo = (await publicClient.readContract({
      address: POSITION_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI,
      functionName: "positionInfo",
      args: [positionTokenId],
    })) as bigint;
    const { tickLower: posTickLower, tickUpper: posTickUpper } = decodePositionInfo(positionInfo);

    const inRange = tickNow >= posTickLower && tickNow <= posTickUpper;
    console.log("Current tick:", tickNow, "| Position range:", posTickLower, "-", posTickUpper);

    if (inRange) {
      console.log("Position is in range. No action.\n");
      continue;
    }

    console.log("Position is out of range. Withdrawing and redepositing only the withdrawn amount...");

    // Record balances BEFORE burn so we only redeposit what we got from this position
    const monBefore = await publicClient.getBalance({ address: account.address });
    const ausdBefore = (await publicClient.readContract({
      address: AUSD_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    const { gasUsed: burnGasUsed } = await burnPosition(publicClient, walletClient, account, positionTokenId);
    console.log("Position burned.");

    const monAfter = await publicClient.getBalance({ address: account.address });
    const ausdAfter = (await publicClient.readContract({
      address: AUSD_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    // Exact amount withdrawn from position: add burn tx gas back so we redeposit 100% of what the position returned (user pays gas).
    const withdrawnMon = monAfter - monBefore + burnGasUsed;
    const withdrawnAusd = ausdAfter - ausdBefore;

    if (tickNow > posTickUpper) {
      // Price above range -> we received AUSD. Redeposit exact same amount.
      if (withdrawnAusd === 0n) {
        console.error("Position burned but no AUSD withdrawn. Restart and deposit again if needed.");
        process.exit(1);
      }
      const tickLowerNew = tickNow - tickRange;
      const tickUpperNew = tickNow - 1;
      console.log("Redepositing exact amount withdrawn (AUSD):", withdrawnAusd.toString(), "wei, range:", tickLowerNew, "-", tickUpperNew);
      await depositSingleSidedAusd(publicClient, walletClient, account, withdrawnAusd, { tickLower: tickLowerNew, tickUpper: tickUpperNew });
      const nextIdAfterAusd = (await publicClient.readContract({
        address: POSITION_MANAGER as `0x${string}`,
        abi: POSITION_MANAGER_ABI,
        functionName: "nextTokenId",
      })) as bigint;
      positionTokenId = nextIdAfterAusd - 1n;
      console.log("New position tokenId:", positionTokenId.toString(), "\n");
    } else {
      // Price below range -> we received MON. Redeposit exact same amount (no cut; gas added back above).
      if (withdrawnMon === 0n) {
        console.error("Position burned but no MON withdrawn. Restart and deposit again if needed.");
        process.exit(1);
      }
      const tickLowerNew = tickNow + 1;
      const tickUpperNew = tickNow + tickRange;
      console.log("Redepositing exact amount withdrawn (MON):", withdrawnMon.toString(), "wei, range:", tickLowerNew, "-", tickUpperNew);
      await depositSingleSidedMon(publicClient, walletClient, account, tickLowerNew, tickUpperNew, withdrawnMon);
      const nextIdAfterMon = (await publicClient.readContract({
        address: POSITION_MANAGER as `0x${string}`,
        abi: POSITION_MANAGER_ABI,
        functionName: "nextTokenId",
      })) as bigint;
      positionTokenId = nextIdAfterMon - 1n;
      console.log("New position tokenId:", positionTokenId.toString(), "\n");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

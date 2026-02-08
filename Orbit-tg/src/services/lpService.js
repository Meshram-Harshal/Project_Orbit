/**
 * MON/AUSD Uniswap v4 LP: single-sided deposit, burn, redeposit.
 * Uses viem; ported from Orbit. privateKey is hex string (with or without 0x).
 */
const {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  parseEther,
} = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const config = require('../config');

const CHAIN_ID = config.CHAIN_ID;
const RPC_URL = config.RPC_URL;
const POSITION_MANAGER = config.POSITION_MANAGER;
const STATE_VIEW = config.STATE_VIEW;
const PERMIT2 = config.PERMIT2;
const MON_NATIVE = config.MON_ADDRESS;
const AUSD_ADDRESS = config.AUSD_ADDRESS;
const FEE = config.FEE;
const TICK_SPACING = config.TICK_SPACING;
const HOOKS = config.HOOKS;
const SLIPPAGE_BPS = config.SLIPPAGE_BPS;

const MINT_POSITION = 0x02;
const SETTLE_PAIR = 0x0d;
const SWEEP = 0x14;
const BURN_POSITION = 0x03;
const TAKE_PAIR = 0x11;

const STATE_VIEW_ABI = [
  {
    name: 'getSlot0',
    type: 'function',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
  },
];

const POSITION_MANAGER_ABI = [
  {
    name: 'modifyLiquidities',
    type: 'function',
    inputs: [
      { name: 'unlockData', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'nextTokenId',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'positionInfo',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'NotApproved',
    type: 'error',
    inputs: [{ name: 'caller', type: 'address' }],
  },
];

const ERC20_ABI = [
  { name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
];

const PERMIT2_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
];

const monadChain = {
  id: CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { decimals: 18, name: 'MON', symbol: 'MON' },
  rpcUrls: { default: { http: [RPC_URL] } },
};

function getPoolKey() {
  const currency0 = BigInt(MON_NATIVE) < BigInt(AUSD_ADDRESS) ? MON_NATIVE : AUSD_ADDRESS;
  const currency1 = BigInt(MON_NATIVE) < BigInt(AUSD_ADDRESS) ? AUSD_ADDRESS : MON_NATIVE;
  const poolId = keccak256(
    encodeAbiParameters(parseAbiParameters('address, address, uint24, int24, address'), [
      currency0,
      currency1,
      FEE,
      TICK_SPACING,
      HOOKS,
    ])
  );
  return { currency0, currency1, poolId };
}

function getPoolId(currency0, currency1, fee, tickSpacing, hooks) {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('address, address, uint24, int24, address'), [
      currency0,
      currency1,
      fee,
      tickSpacing,
      hooks,
    ])
  );
}

function getSqrtRatioAtTick(tick) {
  const MIN_TICK = -887272;
  const MAX_TICK = 887272;
  if (tick < MIN_TICK || tick > MAX_TICK || !Number.isInteger(tick)) throw new Error('Invalid tick');
  const absTick = tick < 0 ? -tick : tick;
  function mulShift(val, mulBy) {
    return (val * BigInt(mulBy)) >> 128n;
  }
  const Q32 = 2n ** 32n;
  const MAX_UINT256 = 2n ** 256n - 1n;
  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = mulShift(ratio, '0xfff97272373d413259a46990580e213a');
  if ((absTick & 0x4) !== 0) ratio = mulShift(ratio, '0xfff2e50f5f656932ef12357cf3c7fdcc');
  if ((absTick & 0x8) !== 0) ratio = mulShift(ratio, '0xffe5caca7e10e4e61c3624eaa0941cd0');
  if ((absTick & 0x10) !== 0) ratio = mulShift(ratio, '0xffcb9843d60f6159c9db58835c926644');
  if ((absTick & 0x20) !== 0) ratio = mulShift(ratio, '0xff973b41fa98c081472e6896dfb254c0');
  if ((absTick & 0x40) !== 0) ratio = mulShift(ratio, '0xff2ea16466c96a3843ec78b326b52861');
  if ((absTick & 0x80) !== 0) ratio = mulShift(ratio, '0xfe5dee046a99a2a811c461f1969c3053');
  if ((absTick & 0x100) !== 0) ratio = mulShift(ratio, '0xfcbe86c7900a88aedcffc83b479aa3a4');
  if ((absTick & 0x200) !== 0) ratio = mulShift(ratio, '0xf987a7253ac413176f2b074cf7815e54');
  if ((absTick & 0x400) !== 0) ratio = mulShift(ratio, '0xf3392b0822b70005940c7a398e4b70f3');
  if ((absTick & 0x800) !== 0) ratio = mulShift(ratio, '0xe7159475a2c29b7443b29c7fa6e889d9');
  if ((absTick & 0x1000) !== 0) ratio = mulShift(ratio, '0xd097f3bdfd2022b8845ad8f792aa5825');
  if ((absTick & 0x2000) !== 0) ratio = mulShift(ratio, '0xa9f746462d870fdf8a65dc1f90e061e5');
  if ((absTick & 0x4000) !== 0) ratio = mulShift(ratio, '0x70d869a156d2a1b890bb3df62baf32f7');
  if ((absTick & 0x8000) !== 0) ratio = mulShift(ratio, '0x31be135f97d08fd981231505542fcfa6');
  if ((absTick & 0x10000) !== 0) ratio = mulShift(ratio, '0x9aa508b5b7a84e1c677de54f3e99bc9');
  if ((absTick & 0x20000) !== 0) ratio = mulShift(ratio, '0x5d6af8dedb81196699c329225ee604');
  if ((absTick & 0x40000) !== 0) ratio = mulShift(ratio, '0x2216e584f5fa1ea926041bedfe98');
  if ((absTick & 0x80000) !== 0) ratio = mulShift(ratio, '0x48a170391f7dc42444e8fa2');
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  const q96 = ratio % Q32 > 0n ? ratio / Q32 + 1n : ratio / Q32;
  return q96;
}

const UINT128_MAX = 2n ** 128n - 1n;

function getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) {
  if (sqrtRatioAX96 >= sqrtRatioBX96) throw new Error('sqrtRatioAX96 must be < sqrtRatioBX96');
  const Q96 = 2n ** 96n;
  const L = (amount0 * sqrtRatioAX96 * sqrtRatioBX96) / ((sqrtRatioBX96 - sqrtRatioAX96) * Q96);
  return L > UINT128_MAX ? UINT128_MAX : L;
}

function getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) {
  if (sqrtRatioAX96 >= sqrtRatioBX96) throw new Error('sqrtRatioAX96 must be < sqrtRatioBX96');
  const Q96 = 2n ** 96n;
  const L = (amount1 * Q96) / (sqrtRatioBX96 - sqrtRatioAX96);
  return L > UINT128_MAX ? UINT128_MAX : L;
}

function decodePositionInfo(positionInfo) {
  const MASK_24 = 0xffffffn;
  const SIGN_BIT_24 = 0x800000;
  const info = BigInt(positionInfo);
  if (info === 0n) throw new Error('NOT_MINTED');
  function signExtend24(value) {
    return value & SIGN_BIT_24 ? value - 0x1000000 : value;
  }
  const tickLowerRaw = Number((info >> 8n) & MASK_24);
  const tickUpperRaw = Number((info >> 32n) & MASK_24);
  return {
    tickLower: signExtend24(tickLowerRaw),
    tickUpper: signExtend24(tickUpperRaw),
  };
}

function normalizePrivateKey(pk) {
  return pk.startsWith('0x') ? pk : `0x${pk}`;
}

function getPublicClient() {
  return createPublicClient({
    chain: monadChain,
    transport: http(RPC_URL),
  });
}

function getClients(privateKey) {
  const key = normalizePrivateKey(privateKey);
  const account = privateKeyToAccount(key);
  const publicClient = getPublicClient();
  const walletClient = createWalletClient({
    chain: monadChain,
    transport: http(RPC_URL),
  });
  return { account, publicClient, walletClient };
}

async function getCurrentTick(publicClient, poolId) {
  const slot0 = await publicClient.readContract({
    address: STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getSlot0',
    args: [poolId],
  });
  if (slot0[0] === 0n) throw new Error('Pool not found');
  return Number(slot0[1]);
}

/**
 * Open single-sided MON position. Returns { positionId }.
 */
async function openPositionSingleSidedMon(privateKey, monAmountWei, tickLower, tickUpper) {
  const { currency0, currency1, poolId } = getPoolKey();
  const { account, publicClient, walletClient } = getClients(privateKey);

  const currentTick = await getCurrentTick(publicClient, poolId);
  if (currentTick >= tickLower) {
    throw new Error(`Single-sided MON requires range above current price. Current tick: ${currentTick}`);
  }

  const amount0Max = (monAmountWei * (10000n + BigInt(SLIPPAGE_BPS))) / 10000n;
  const amount1Max = 0n;
  const sqrtRatioLower = getSqrtRatioAtTick(tickLower);
  const sqrtRatioUpper = getSqrtRatioAtTick(tickUpper);
  const liquidity = getLiquidityForAmount0(sqrtRatioLower, sqrtRatioUpper, monAmountWei);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const poolKey = { currency0, currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: HOOKS };

  const mintParams = encodeAbiParameters(
    parseAbiParameters('(address, address, uint24, int24, address), int24, int24, uint256, uint128, uint128, address, bytes'),
    [
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      account.address,
      '0x',
    ]
  );
  const settleParams = encodeAbiParameters(parseAbiParameters('address, address'), [currency0, currency1]);
  const sweepParams = encodeAbiParameters(parseAbiParameters('address, address'), [MON_NATIVE, account.address]);

  const actions = '0x' + [MINT_POSITION, SETTLE_PAIR, SWEEP].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unlockData = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, [mintParams, settleParams, sweepParams]]);

  await walletClient.writeContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
    value: amount0Max,
    account,
    chain: monadChain,
  });

  const nextId = await publicClient.readContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'nextTokenId',
  });
  const positionId = (nextId - 1n).toString();
  return { positionId, ownerAddress: account.address };
}

/**
 * Burn position. Returns { gasUsed }.
 */
async function burnPositionOnly(privateKey, positionId) {
  const { currency0, currency1 } = getPoolKey();
  const { account, publicClient, walletClient } = getClients(privateKey);

  const tokenId = BigInt(positionId);
  const burnParams = encodeAbiParameters(parseAbiParameters('uint256, uint128, uint128, bytes'), [
    tokenId,
    0n,
    0n,
    '0x',
  ]);
  const takeParams = encodeAbiParameters(parseAbiParameters('address, address, address'), [
    currency0,
    currency1,
    account.address,
  ]);

  const actions = '0x' + [BURN_POSITION, TAKE_PAIR].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unlockData = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, [burnParams, takeParams]]);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const hash = await walletClient.writeContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
    value: 0n,
    account,
    chain: monadChain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const gasUsed = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
  return { gasUsed };
}

const RETRY_DELAY_MS = 2500;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read positionInfo with one retry after delay if 0 (avoids NOT_MINTED from stale RPC right after mint).
 */
async function readPositionInfoWithRetry(publicClient, positionId) {
  let raw = await publicClient.readContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'positionInfo',
    args: [BigInt(positionId)],
  });
  const info = BigInt(raw);
  if (info === 0n) {
    await sleep(RETRY_DELAY_MS);
    raw = await publicClient.readContract({
      address: POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'positionInfo',
      args: [BigInt(positionId)],
    });
  }
  return raw;
}

/**
 * Check if position is in range; if not, burn and redeposit. Returns { inRange, newPositionId?, newTickLower?, newTickUpper? }.
 */
async function checkAndRebalance(privateKey, positionId, tickRange) {
  const { poolId } = getPoolKey();
  const { account, publicClient, walletClient } = getClients(privateKey);

  const currentTick = await getCurrentTick(publicClient, poolId);
  const positionInfo = await readPositionInfoWithRetry(publicClient, positionId);
  const { tickLower: posTickLower, tickUpper: posTickUpper } = decodePositionInfo(positionInfo);

  const inRange = currentTick >= posTickLower && currentTick <= posTickUpper;
  if (inRange) return { inRange: true };

  const monBefore = await publicClient.getBalance({ address: account.address });
  const ausdBefore = await publicClient.readContract({
    address: AUSD_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  const { gasUsed: burnGasUsed } = await burnPositionOnly(privateKey, positionId);

  const monAfter = await publicClient.getBalance({ address: account.address });
  const ausdAfter = await publicClient.readContract({
    address: AUSD_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  const withdrawnMon = monAfter - monBefore + burnGasUsed;
  const withdrawnAusd = ausdAfter - ausdBefore;

  if (currentTick > posTickUpper) {
    if (withdrawnAusd === 0n) throw new Error('No AUSD withdrawn');
    const tickLowerNew = currentTick - tickRange;
    const tickUpperNew = currentTick - 1;
    await depositSingleSidedAusd(privateKey, withdrawnAusd, tickLowerNew, tickUpperNew);
  } else {
    if (withdrawnMon === 0n) throw new Error('No MON withdrawn');
    const tickLowerNew = currentTick + 1;
    const tickUpperNew = currentTick + tickRange;
    await depositSingleSidedMonOnly(privateKey, tickLowerNew, tickUpperNew, withdrawnMon);
  }

  const nextId = await publicClient.readContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'nextTokenId',
  });
  const newPositionId = (nextId - 1n).toString();
  const newTickLower = currentTick > posTickUpper ? currentTick - tickRange : currentTick + 1;
  const newTickUpper = currentTick > posTickUpper ? currentTick - 1 : currentTick + tickRange;

  return {
    inRange: false,
    newPositionId,
    newTickLower,
    newTickUpper,
  };
}

async function depositSingleSidedMonOnly(privateKey, tickLower, tickUpper, monAmountWei) {
  const { currency0, currency1, poolId } = getPoolKey();
  const { account, publicClient, walletClient } = getClients(privateKey);

  const currentTick = await getCurrentTick(publicClient, poolId);
  if (currentTick >= tickLower) throw new Error('Range must be above current price');

  const amount0Max = (monAmountWei * (10000n + BigInt(SLIPPAGE_BPS))) / 10000n;
  const amount1Max = 0n;
  const sqrtRatioLower = getSqrtRatioAtTick(tickLower);
  const sqrtRatioUpper = getSqrtRatioAtTick(tickUpper);
  const liquidity = getLiquidityForAmount0(sqrtRatioLower, sqrtRatioUpper, monAmountWei);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const poolKey = { currency0, currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: HOOKS };

  const mintParams = encodeAbiParameters(
    parseAbiParameters('(address, address, uint24, int24, address), int24, int24, uint256, uint128, uint128, address, bytes'),
    [
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      account.address,
      '0x',
    ]
  );
  const settleParams = encodeAbiParameters(parseAbiParameters('address, address'), [currency0, currency1]);
  const sweepParams = encodeAbiParameters(parseAbiParameters('address, address'), [MON_NATIVE, account.address]);

  const actions = '0x' + [MINT_POSITION, SETTLE_PAIR, SWEEP].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unlockData = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, [mintParams, settleParams, sweepParams]]);

  await walletClient.writeContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
    value: amount0Max,
    account,
    chain: monadChain,
  });
}

async function depositSingleSidedAusd(privateKey, ausdAmountWei, tickLower, tickUpper) {
  const { currency0, currency1, poolId } = getPoolKey();
  const { account, publicClient, walletClient } = getClients(privateKey);

  const amount0Max = 0n;
  const amount1Max = (ausdAmountWei * (10000n + BigInt(SLIPPAGE_BPS))) / 10000n;
  const sqrtRatioLower = getSqrtRatioAtTick(tickLower);
  const sqrtRatioUpper = getSqrtRatioAtTick(tickUpper);
  const liquidity = getLiquidityForAmount1(sqrtRatioLower, sqrtRatioUpper, ausdAmountWei);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const poolKey = { currency0, currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: HOOKS };

  const mintParams = encodeAbiParameters(
    parseAbiParameters('(address, address, uint24, int24, address), int24, int24, uint256, uint128, uint128, address, bytes'),
    [
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      account.address,
      '0x',
    ]
  );
  const settleParams = encodeAbiParameters(parseAbiParameters('address, address'), [currency0, currency1]);

  const permit2Expiration = 281474976710655n;
  const amount160 = amount1Max > 2n ** 160n - 1n ? 2n ** 160n - 1n : amount1Max;

  await walletClient.writeContract({
    address: AUSD_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [PERMIT2, amount1Max],
    account,
    chain: monadChain,
  });

  await walletClient.writeContract({
    address: PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'approve',
    args: [AUSD_ADDRESS, POSITION_MANAGER, amount160, permit2Expiration],
    account,
    chain: monadChain,
  });

  const actions = '0x' + [MINT_POSITION, SETTLE_PAIR].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unlockData = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, [mintParams, settleParams]]);

  await walletClient.writeContract({
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
    value: 0n,
    account,
    chain: monadChain,
  });
}

async function fetchCurrentTick() {
  const publicClient = getPublicClient();
  const { poolId } = getPoolKey();
  return getCurrentTick(publicClient, poolId);
}

module.exports = {
  fetchCurrentTick,
  getPoolKey,
  openPositionSingleSidedMon,
  burnPositionOnly,
  checkAndRebalance,
  getClients,
  decodePositionInfo,
};

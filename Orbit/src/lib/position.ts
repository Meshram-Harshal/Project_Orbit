/**
 * Decode Uniswap v4 PositionInfo packed uint256.
 * Layout (LSB first): 8 bits hasSubscriber, 24 bits tickLower, 24 bits tickUpper, 200 bits poolId.
 * Decode with bigint to avoid Number() precision loss on large uint256.
 */
const MASK_24 = 0xffffffn;
const SIGN_BIT_24 = 0x800000;

function signExtend24(value: number): number {
  if (value & SIGN_BIT_24) return value - 0x1000000;
  return value;
}

export function decodePositionInfo(positionInfo: bigint): { tickLower: number; tickUpper: number } {
  const tickLowerRaw = Number((positionInfo >> 8n) & MASK_24);
  const tickUpperRaw = Number((positionInfo >> 32n) & MASK_24);
  return {
    tickLower: signExtend24(tickLowerRaw),
    tickUpper: signExtend24(tickUpperRaw),
  };
}

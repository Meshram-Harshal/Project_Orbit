import { createPublicClient as createViemPublicClient, createWalletClient as createViemWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { WalletClient } from "viem";
import {
  CHAIN_ID,
  RPC_URL,
  POSITION_MANAGER,
  STATE_VIEW,
  MON_ADDRESS,
  AUSD_ADDRESS,
  FEE,
  TICK_SPACING,
  HOOKS,
} from "../config.js";
import { getPoolId } from "../lib/poolMath.js";
import { STATE_VIEW_ABI, POSITION_MANAGER_ABI } from "../lib/abis.js";

export const monadChain = {
  id: CHAIN_ID,
  name: "Monad",
  nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" },
  rpcUrls: { default: { http: [RPC_URL] } },
};

export function getPoolKey(): {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  poolId: `0x${string}`;
} {
  const MON_NATIVE = MON_ADDRESS as `0x${string}`;
  const AUSD = AUSD_ADDRESS as `0x${string}`;
  const [currency0, currency1]: [`0x${string}`, `0x${string}`] =
    BigInt(MON_NATIVE) < BigInt(AUSD)
      ? [MON_NATIVE, AUSD]
      : [AUSD, MON_NATIVE];
  const poolId = getPoolId(currency0, currency1, FEE, TICK_SPACING, HOOKS as `0x${string}`);
  return { currency0, currency1, poolId };
}

export function createPublicClient() {
  return createViemPublicClient({
    chain: monadChain,
    transport: http(RPC_URL),
  });
}

export function getWalletClient(privateKey: `0x${string}`): WalletClient {
  const account = privateKeyToAccount(privateKey);
  return createViemWalletClient({
    chain: monadChain,
    transport: http(RPC_URL),
    account,
  }) as WalletClient;
}

export async function getCurrentTick(publicClient: ReturnType<typeof createPublicClient>, poolId: `0x${string}`): Promise<number> {
  const slot0 = (await publicClient.readContract({
    address: STATE_VIEW as `0x${string}`,
    abi: STATE_VIEW_ABI,
    functionName: "getSlot0",
    args: [poolId],
  })) as readonly [bigint, number, number, number];
  if (slot0[0] === 0n) throw new Error("Pool not found");
  return Number(slot0[1]);
}

export async function getNextTokenId(publicClient: ReturnType<typeof createPublicClient>): Promise<bigint> {
  return (await publicClient.readContract({
    address: POSITION_MANAGER as `0x${string}`,
    abi: POSITION_MANAGER_ABI,
    functionName: "nextTokenId",
  })) as bigint;
}

export { POSITION_MANAGER_ABI, STATE_VIEW_ABI };

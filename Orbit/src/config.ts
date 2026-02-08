/**
 * Load .env and export config. User inputs: TICK_LOWER, TICK_UPPER, MON_AMOUNT (+ all other data).
 */
import "dotenv/config";

function env(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") throw new Error(`Missing required env: ${key}`);
  return v;
}

function envInt(key: string): number {
  return parseInt(env(key), 10);
}

export const RPC_URL = env("RPC_URL");
export const CHAIN_ID = envInt("CHAIN_ID");
export const POSITION_MANAGER = env("POSITION_MANAGER");
export const STATE_VIEW = env("STATE_VIEW");
export const PERMIT2 = env("PERMIT2");

export const MON_ADDRESS = env("MON_ADDRESS");
export const AUSD_ADDRESS = env("AUSD_ADDRESS");
export const MON_DECIMALS = envInt("MON_DECIMALS");
export const AUSD_DECIMALS = envInt("AUSD_DECIMALS");

export const FEE = envInt("FEE");
export const TICK_SPACING = envInt("TICK_SPACING");
export const HOOKS = env("HOOKS");

export function getPrivateKey(): string {
  const pk = env("PRIVATE_KEY");
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

export const SLIPPAGE_BPS = process.env["SLIPPAGE_BPS"] ? parseInt(process.env["SLIPPAGE_BPS"], 10) : 100;
export const CHECK_AFTER_SECONDS = process.env["CHECK_AFTER_SECONDS"]
  ? parseInt(process.env["CHECK_AFTER_SECONDS"], 10)
  : 120;

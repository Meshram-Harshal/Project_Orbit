import "dotenv/config";

function env(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") throw new Error(`Missing required env: ${key}`);
  return v;
}

function envInt(key: string): number {
  return parseInt(env(key), 10);
}

function envOptionalInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return parseInt(v, 10);
}

/** Telegram bot token (TELEGRAM_TOKEN or BOT_TOKEN) */
const token = process.env.TELEGRAM_TOKEN?.trim() || process.env.BOT_TOKEN?.trim();
if (!token) throw new Error("Missing required env: TELEGRAM_TOKEN or BOT_TOKEN");
export const BOT_TOKEN = token;
export const MONGODB_URI = env("MONGODB_URI");

export const RPC_URL = env("RPC_URL");
export const CHAIN_ID = envInt("CHAIN_ID");
export const POSITION_MANAGER = env("POSITION_MANAGER");
export const STATE_VIEW = env("STATE_VIEW");
export const PERMIT2 = env("PERMIT2");

export const MON_ADDRESS = env("MON_ADDRESS");
export const AUSD_ADDRESS = env("AUSD_ADDRESS");
export const MON_DECIMALS = envOptionalInt("MON_DECIMALS", 18);
export const AUSD_DECIMALS = envOptionalInt("AUSD_DECIMALS", 6);
export const FEE = envInt("FEE");
export const TICK_SPACING = envInt("TICK_SPACING");
export const HOOKS = env("HOOKS");

export const SLIPPAGE_BPS = process.env.SLIPPAGE_BPS ? parseInt(process.env.SLIPPAGE_BPS, 10) : 100;

/** Rebalance check interval in ms (1 minute) */
export const REBALANCE_INTERVAL_MS = 60 * 1000;

/** RPC retries for transient failures (e.g. fetch failed, rate limit) */
export const RPC_RETRY_COUNT = 3;
export const RPC_RETRY_DELAY_MS = 2000;

import { getAllActivePositions, checkAndRebalancePosition } from "./positionService.js";
import { REBALANCE_INTERVAL_MS, RPC_RETRY_COUNT, RPC_RETRY_DELAY_MS } from "../config.js";

let intervalId: ReturnType<typeof setInterval> | null = null;

function isTransientRpcError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("fetch failed") ||
    msg.includes("HTTP request failed") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("network")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function startRebalanceCron(): void {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    try {
      const positions = await getAllActivePositions();
      for (const pos of positions) {
        for (let attempt = 1; attempt <= RPC_RETRY_COUNT; attempt++) {
          try {
            await checkAndRebalancePosition(pos);
            break;
          } catch (e) {
            if (attempt < RPC_RETRY_COUNT && isTransientRpcError(e)) {
              await sleep(RPC_RETRY_DELAY_MS);
              continue;
            }
            if (isTransientRpcError(e)) {
              console.warn("Rebalance skipped for position %s (RPC error, will retry next cycle)", pos._id);
            } else {
              console.error("Rebalance error for position", pos._id, e);
            }
            break;
          }
        }
      }
    } catch (e) {
      if (isTransientRpcError(e)) {
        console.warn("Rebalance cron: RPC error, will retry next cycle");
      } else {
        console.error("Rebalance cron error", e);
      }
    }
  }, REBALANCE_INTERVAL_MS);
  console.log("Rebalance cron started (interval %d ms)", REBALANCE_INTERVAL_MS);
}

export function stopRebalanceCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

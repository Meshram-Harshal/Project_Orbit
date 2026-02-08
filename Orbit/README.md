# MON/AUSD Single-Sided LP Keeper

Deposit MON as single-sided liquidity in the MON/AUSD Uniswap v4 pool, then after a delay (default 2 minutes) check if the position is still in range. If out of range, withdraw and redeposit:

- **Price above range** → you receive AUSD → redeposit as single-sided AUSD LP (range below current price).
- **Price below range** → you receive MON → redeposit as single-sided MON LP (range above current price).

## Setup

1. Copy `.env.example` to `.env` and fill in `RPC_URL`, `PRIVATE_KEY`, and other contract/token vars. Optionally set `SLIPPAGE_BPS`, `CHECK_AFTER_SECONDS`.

2. Install and run:

```bash
npm install
npm start
```

3. When prompted in the terminal:
   - **MON amount** – e.g. `1` or `0.5`
   - **Tick range** – e.g. `20` → position will be **tickLower = current tick + 1**, **tickUpper = current tick + 20**

## Flow

1. Fetches current pool tick and prompts you for MON amount and tick range (e.g. 20 → lower = current+1, upper = current+20).
2. Mints a new position with MON only in that range; records the position `tokenId`.
3. Waits `CHECK_AFTER_SECONDS` (default 120).
4. Fetches current tick and position range:
   - If **in range**: exits (no action).
   - If **above range**: burns position, then mints single-sided AUSD in a new range (current tick −5 to −1).
   - If **below range**: burns position, then mints single-sided MON in a new range (current tick +1 to +5).

## Reference

Based on the Uniswap v4 patterns in `../uniswap_templates` (single-sided MON and AUSD mints, pool state, config).

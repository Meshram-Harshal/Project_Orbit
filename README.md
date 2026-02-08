# Orbit Telegram Bot

Telegram bot for managing **single-sided MON/AUSD liquidity** on Uniswap v4 (Monad). Create wallets, open and close LP positions, and withdraw funds—all from Telegram. Positions are automatically rebalanced when price moves out of range.

## Features

- **Wallet**: Create a custodial wallet or import by private key
- **Open position**: Deposit MON into a tick range (single-sided MON/AUSD LP)
- **Check positions**: List positions with fee earned
- **Close position**: Burn LP and withdraw to your wallet
- **Export keys**: View private key for custodial wallets only
- **Withdraw**: Send MON or AUSD to any address
- **Auto-rebalance**: Cron runs every minute to rebalance positions that are out of range

## Prerequisites

- **Node.js** 18+
- **MongoDB** (local or Atlas)
- **Telegram bot token** from [@BotFather](https://t.me/BotFather)
- **RPC** for Monad (e.g. Alchemy, public endpoint)
- **Contract addresses** for the MON/AUSD pool (Position Manager, State View, token addresses, etc.)

## Setup

1. **Clone and install**

   ```bash
   cd orbit-telegram-bot
   npm install
   ```

2. **Environment**

   Copy the example env and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Required variables (see [.env.example](.env.example)):

   | Variable           | Description                          |
   |--------------------|--------------------------------------|
   | `TELEGRAM_TOKEN`   | Bot token from BotFather             |
   | `RPC_URL`          | Monad RPC URL                        |
   | `CHAIN_ID`         | Chain ID (e.g. 143 for Monad)        |
   | `MONGODB_URI`      | MongoDB connection string            |
   | `POSITION_MANAGER` | Uniswap v4 Position Manager address  |
   | `STATE_VIEW`       | Pool state view contract             |
   | `PERMIT2`          | Permit2 address                      |
   | `MON_ADDRESS`      | MON token address                    |
   | `AUSD_ADDRESS`     | AUSD token address                   |
   | `FEE`              | Pool fee (e.g. 500 = 0.05%)           |
   | `TICK_SPACING`     | Pool tick spacing (e.g. 1)           |
   | `HOOKS`            | Pool hooks address (zero if none)    |

   Optional: `MON_DECIMALS`, `AUSD_DECIMALS`, `SLIPPAGE_BPS`.

3. **Run the bot**

   ```bash
   npm start
   ```

   Or build and run compiled JS:

   ```bash
   npm run build
   node dist/index.js
   ```

## Scripts

| Command        | Description                    |
|----------------|--------------------------------|
| `npm start`    | Run bot with `tsx` (dev)       |
| `npm run build`| Compile TypeScript to `dist/`  |
| `npm run db:reset` | Drop DB (see script usage) |

## Project structure

```
src/
├── index.ts           # Entry: DB, bot, rebalance cron
├── config.ts          # Env and constants
├── bot/
│   ├── handlers.ts    # Commands and callbacks
│   ├── keyboards.ts   # Inline keyboards
│   ├── session.ts     # Session types
│   └── sessionStore.ts
├── db/
│   ├── connection.ts
│   ├── models/        # User, Wallet, Position
│   └── ...
├── lib/               # ABIs, pool math, position helpers
├── services/
│   ├── blockchain.ts  # RPC, pool key, tick
│   ├── lpService.ts   # Mint/burn/rebalance LP
│   ├── positionService.ts
│   ├── rebalanceCron.ts
│   └── wallet.ts
└── scripts/           # e.g. drop-db
```

## Security notes

- **Private keys**: Imported and custodial keys are stored in MongoDB. Secure your DB and restrict access.
- **.env**: Never commit `.env`. Use `.env.example` as a template only.
- Run in production behind proper infra (secrets, network, backups).

## License

Private / project-specific.

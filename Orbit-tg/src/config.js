const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const required = ['TELEGRAM_TOKEN', 'RPC_URL', 'MONGODB_URI', 'ENCRYPTION_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

if (process.env.ENCRYPTION_KEY.length < 32) {
  console.error('ENCRYPTION_KEY must be at least 32 characters');
  process.exit(1);
}

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  RPC_URL: process.env.RPC_URL,
  MONGODB_URI: process.env.MONGODB_URI,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  CHAIN_ID: parseInt(process.env.CHAIN_ID || '143', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  // LP (MON/AUSD Uniswap v4)
  POSITION_MANAGER: process.env.POSITION_MANAGER || '0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016',
  STATE_VIEW: process.env.STATE_VIEW || '0x77395f3b2e73ae90843717371294fa97cc419d64',
  PERMIT2: process.env.PERMIT2 || '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  MON_ADDRESS: process.env.MON_ADDRESS || '0x0000000000000000000000000000000000000000',
  AUSD_ADDRESS: process.env.AUSD_ADDRESS || '0x00000000efe302beaa2b3e6e1b18d08d69a9012a',
  FEE: parseInt(process.env.FEE || '500', 10),
  TICK_SPACING: parseInt(process.env.TICK_SPACING || '1', 10),
  HOOKS: process.env.HOOKS || '0x0000000000000000000000000000000000000000',
  SLIPPAGE_BPS: parseInt(process.env.SLIPPAGE_BPS || '100', 10),
};

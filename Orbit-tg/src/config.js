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
};

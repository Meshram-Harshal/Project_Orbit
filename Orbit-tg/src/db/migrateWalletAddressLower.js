/**
 * One-time migration: set walletAddressLower from walletAddress for existing User and OpenPosition docs.
 * Run with: node src/db/migrateWalletAddressLower.js (from Orbit-tg, with MONGODB_URI in env)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const OpenPosition = require('./models/OpenPosition');

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Set MONGODB_URI or MONGO_URI');
    process.exit(1);
  }
  await mongoose.connect(uri);

  let n = 0;
  for (const doc of await User.find({ $or: [{ walletAddressLower: { $exists: false } }, { walletAddressLower: '' }] })) {
    doc.walletAddressLower = (doc.walletAddress || '').toLowerCase();
    await doc.save();
    n++;
  }
  console.log('Users updated:', n);

  n = 0;
  for (const doc of await OpenPosition.find({ $or: [{ walletAddressLower: { $exists: false } }, { walletAddressLower: '' }] })) {
    doc.walletAddressLower = (doc.walletAddress || '').toLowerCase();
    await doc.save();
    n++;
  }
  console.log('OpenPositions updated:', n);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

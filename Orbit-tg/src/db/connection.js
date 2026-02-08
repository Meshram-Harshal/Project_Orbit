const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function connectDB(uri) {
  try {
    await mongoose.connect(uri);
    logger.info('Connected to MongoDB');
    const User = require('./models/User');
    const OpenPosition = require('./models/OpenPosition');
    const Transaction = require('./models/Transaction');
    await Promise.all([User.createIndexes(), OpenPosition.createIndexes(), Transaction.createIndexes()]);
  } catch (err) {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
  }

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB runtime error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
}

module.exports = { connectDB };

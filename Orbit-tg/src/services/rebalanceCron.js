/**
 * Every 1 minute: fetch current MON/AUSD tick, then for each open position
 * check if in range; if not, burn and redeposit and update DB.
 */
const OpenPosition = require('../db/models/OpenPosition');
const User = require('../db/models/User');
const { decrypt } = require('./crypto');
const config = require('../config');
const { fetchCurrentTick, checkAndRebalance } = require('./lpService');
const logger = require('../utils/logger');

const INTERVAL_MS = 60 * 1000; // 1 minute

let intervalId = null;

async function runRebalanceCycle() {
  try {
    const positions = await OpenPosition.find({});
    if (positions.length === 0) return;

    const currentTick = await fetchCurrentTick();

    for (const pos of positions) {
      try {
        const user = await User.findOne({ telegramId: pos.telegramId });
        if (!user) continue;
        // Only rebalance if current wallet is the one that opened the position (avoids NotApproved)
        if (user.walletAddress.toLowerCase() !== pos.walletAddress.toLowerCase()) {
          logger.warn(`Position ${pos.positionId} owner ${pos.walletAddress} != user wallet; skip rebalance`);
          continue;
        }

        const privateKey = decrypt(
          {
            ciphertext: user.encryptedPrivateKey,
            iv: user.iv,
            authTag: user.authTag,
            salt: user.salt,
          },
          config.ENCRYPTION_KEY
        );

        const result = await checkAndRebalance(
          privateKey,
          pos.positionId,
          pos.tickRange
        );

        if (!result.inRange && result.newPositionId) {
          await OpenPosition.updateOne(
            { positionId: pos.positionId },
            {
              $set: {
                positionId: result.newPositionId,
                tickLower: result.newTickLower,
                tickUpper: result.newTickUpper,
                lastRebalanceAt: new Date(),
              },
            }
          );
          logger.info(`Rebalanced position ${pos.positionId} -> ${result.newPositionId} for user ${pos.telegramId}`);
        }
      } catch (err) {
        const msg = err.message || String(err);
        logger.error(`Rebalance failed for position ${pos.positionId}: ${msg}`);
        if (msg.includes('NOT_MINTED') || msg.includes('not minted')) {
          await OpenPosition.deleteOne({ positionId: pos.positionId });
          logger.info(`Removed invalid position ${pos.positionId} from DB (already closed or invalid).`);
        } else if (msg.includes('NotApproved') || (err.signature && err.signature === '0x0ca968d8')) {
          await OpenPosition.deleteOne({ positionId: pos.positionId });
          logger.info(
            `Removed position ${pos.positionId} from DB (NotApproved: position is not owned by ${pos.walletAddress}; may have been opened with another wallet).`
          );
        }
      }
    }
  } catch (err) {
    logger.error('Rebalance cycle error:', err);
  }
}

function startRebalanceCron() {
  if (intervalId) return;
  intervalId = setInterval(runRebalanceCycle, INTERVAL_MS);
  logger.info(`Rebalance cron started (every ${INTERVAL_MS / 1000}s)`);
  runRebalanceCycle();
}

function stopRebalanceCron() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Rebalance cron stopped');
  }
}

module.exports = { startRebalanceCron, stopRebalanceCron, runRebalanceCycle };

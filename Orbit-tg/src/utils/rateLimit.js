const MAX_REQUESTS = 3;
const WINDOW_MS = 1000;

const userTimestamps = new Map();

function isAllowed(telegramId) {
  const now = Date.now();
  const key = String(telegramId);

  if (!userTimestamps.has(key)) {
    userTimestamps.set(key, [now]);
    return true;
  }

  const timestamps = userTimestamps.get(key).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS) {
    userTimestamps.set(key, timestamps);
    return false;
  }

  timestamps.push(now);
  userTimestamps.set(key, timestamps);
  return true;
}

// Clean up stale entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of userTimestamps.entries()) {
    const active = timestamps.filter((t) => now - t < WINDOW_MS);
    if (active.length === 0) {
      userTimestamps.delete(key);
    } else {
      userTimestamps.set(key, active);
    }
  }
}, 60_000).unref();

module.exports = { isAllowed };

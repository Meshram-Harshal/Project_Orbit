const winston = require('winston');
const path = require('path');

const redactFormat = winston.format((info) => {
  if (typeof info.message === 'string') {
    // Redact anything that looks like a private key (64 hex chars with optional 0x prefix)
    info.message = info.message.replace(/0x[0-9a-fA-F]{64}/g, '0x[REDACTED]');
    // Redact mnemonic-like sequences (12+ words)
    info.message = info.message.replace(
      /(\b[a-z]{3,}\b\s+){11,}[a-z]{3,}\b/gi,
      '[REDACTED_MNEMONIC]'
    );
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: path.resolve(__dirname, '..', '..', 'logs', 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.resolve(__dirname, '..', '..', 'logs', 'combined.log'),
    }),
  ],
});

module.exports = logger;

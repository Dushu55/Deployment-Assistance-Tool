import winston from 'winston';
import 'winston-daily-rotate-file';

const isCi = process.env.CI === 'true';

// Basic sensitive data redaction formatter
const redactSensitiveData = winston.format((info) => {
  if (info.message && typeof info.message === 'string') {
    // Redact Bearer tokens, private keys, API keys using simple regex
    let msg = info.message as string;
    msg = msg.replace(/Bearer\s+[A-Za-z0-9\-\._~+\/]+/gi, 'Bearer [REDACTED]');
    msg = msg.replace(/(api_key|apiKey|secret|token)["':=\s]+[A-Za-z0-9\-\_]+/gi, '$1: [REDACTED]');
    info.message = msg;
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    redactSensitiveData(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    isCi ? winston.format.json() : winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaString = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level}: ${message}${metaString}`;
      })
    )
  ),
  transports: [
    new winston.transports.Console(),
    // Keep a persistent daily rotating log on the local disk
    new winston.transports.DailyRotateFile({
      dirname: 'logs',
      filename: 'dat-audit-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json() // Always use JSON for file-based audit logs
      )
    })
  ]
});

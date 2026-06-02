import path from 'path';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { redactString, redactDeep, registerEnvSecrets } from './utils/redact.js';

const isCi = process.env.CI === 'true';

// Anchor the audit log dir to an ABSOLUTE path captured at module load (before any --path/--repo
// retargeting calls process.chdir). A relative 'logs' would otherwise resolve against the scanned
// app's directory mid-run and crash (ENOENT) or scatter logs into every target.
const LOG_DIR = path.resolve(process.cwd(), 'logs');

// Register literal env-var secret values so they're scrubbed wherever they appear.
registerEnvSecrets();

// Redact secrets from BOTH the message and the structured metadata (the previous formatter only
// scrubbed `message`, so a token in a meta field would leak).
const redactSensitiveData = winston.format((info) => {
  if (typeof info.message === 'string') {
    info.message = redactString(info.message);
  }
  for (const key of Object.keys(info)) {
    if (key === 'message' || key === 'level' || key === 'timestamp') continue;
    (info as Record<string, unknown>)[key] = redactDeep((info as Record<string, unknown>)[key]);
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
      dirname: LOG_DIR,
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

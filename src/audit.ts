import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export interface AuditContext {
  actor: string;           // Username or system invoking the scan
  source: 'CLI' | 'GITHUB_WEBHOOK' | 'CI';
  commitSha?: string;
  branch?: string;
  repo?: string;
}

/**
 * Generates a SHA-256 hash of a file to prove its integrity.
 */
function hashFile(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      return 'FILE_NOT_FOUND';
    }
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error) {
    return 'HASH_FAILED';
  }
}

/**
 * Emits a structured AUDIT_START event into the permanent log rotation.
 */
export function emitAuditStart(context: AuditContext, configPath: string): string {
  const executionId = crypto.randomUUID();
  const configHash = hashFile(path.resolve(process.cwd(), configPath));

  logger.info('AUDIT_EVENT: PIPELINE_START', {
    auditEvent: 'PIPELINE_START',
    executionId,
    timestamp: new Date().toISOString(),
    actor: context.actor,
    source: context.source,
    repository: context.repo || 'local-workspace',
    branch: context.branch || 'unknown',
    commitSha: context.commitSha || 'unknown',
    configIntegrityHash: configHash,
    configPath
  });

  return executionId;
}

/**
 * Emits a structured AUDIT_END event detailing the exact outcomes.
 */
export function emitAuditEnd(executionId: string, success: boolean, score: number, issuesFound: number) {
  logger.info('AUDIT_EVENT: PIPELINE_END', {
    auditEvent: 'PIPELINE_END',
    executionId,
    timestamp: new Date().toISOString(),
    status: success ? 'PASSED' : 'FAILED',
    deploymentReadinessScore: score,
    totalIssuesFound: issuesFound
  });
}

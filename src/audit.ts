import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { ScannerResult } from './types.js';

export interface ScannerMetrics {
  scannersRun: number;
  scannersFailed: number;
  scannersSkipped: number;
  scanners: { name: string; durationMs: number; success: boolean; skipped: boolean; issueCount: number }[];
}

/** Summarize per-scanner outcomes for the structured audit event (data already on each result). */
export function summarizeScannerMetrics(results: ScannerResult[]): ScannerMetrics {
  const scanners = results.map(r => ({
    name: r.scannerName,
    durationMs: r.durationMs,
    success: r.success,
    skipped: r.skipped === true,
    issueCount: r.issues.length
  }));
  return {
    scannersRun: scanners.filter(s => !s.skipped).length,
    scannersFailed: scanners.filter(s => !s.success).length,
    scannersSkipped: scanners.filter(s => s.skipped).length,
    scanners
  };
}

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
 * Every infrastructure mutation DAT performs (provision/migrate/teardown of an ephemeral DB,
 * Cloud Run service, or container image) is logged as a structured INFRA_MUTATION audit event so
 * the full lifecycle — and any leaked resource — is traceable from the logs.
 */
export type InfraAction =
  | 'DB_PROVISION' | 'DB_MIGRATE' | 'DB_TEARDOWN'
  | 'DEPLOY_CREATE' | 'DEPLOY_READY' | 'DEPLOY_TEARDOWN'
  | 'IMAGE_TEARDOWN';

export function emitInfraEvent(
  action: InfraAction,
  status: 'START' | 'OK' | 'FAIL' | 'SKIP',
  detail: Record<string, unknown> = {},
): void {
  const level = status === 'FAIL' ? 'error' : 'info';
  logger.log(level, `INFRA_EVENT: ${action} ${status}`, {
    auditEvent: 'INFRA_MUTATION',
    action,
    status,
    timestamp: new Date().toISOString(),
    ...detail,
  });
}

/**
 * Emits a structured AUDIT_END event detailing the exact outcomes.
 */
export function emitAuditEnd(executionId: string, success: boolean, score: number, issuesFound: number, metrics?: ScannerMetrics) {
  logger.info('AUDIT_EVENT: PIPELINE_END', {
    auditEvent: 'PIPELINE_END',
    executionId,
    timestamp: new Date().toISOString(),
    status: success ? 'PASSED' : 'FAILED',
    deploymentReadinessScore: score,
    totalIssuesFound: issuesFound,
    ...(metrics ? {
      scannersRun: metrics.scannersRun,
      scannersFailed: metrics.scannersFailed,
      scannersSkipped: metrics.scannersSkipped,
      scanners: metrics.scanners
    } : {})
  });
}

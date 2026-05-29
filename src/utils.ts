import { Severity } from './types.js';

/**
 * Maps varying severity strings from different scanner tools to the unified Severity type.
 */
export function mapSeverity(level: string): Severity {
  if (!level) return 'INFO';
  const norm = level.toUpperCase().trim().split(' ')[0];
  switch (norm) {
    case 'CRITICAL':
    case 'FATAL':
      return 'CRITICAL';
    case 'HIGH':
    case 'ERROR':
      return 'HIGH';
    case 'MEDIUM':
    case 'WARNING':
    case 'WARN':
      return 'MEDIUM';
    case 'LOW':
    case 'INFO':
    case 'INFORMATIONAL':
    case 'STYLE':
      return 'LOW';
    default:
      return 'HIGH';
  }
}

/**
 * Calculates the Deployment Readiness Score (from 0 to 100).
 */
export function calculateReadinessScore(summary: {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info?: number;
}): number {
  const score = 100 - 
    (summary.critical * 20) - 
    (summary.high * 10) - 
    (summary.medium * 5) - 
    (summary.low * 1);
  return Math.max(0, score);
}

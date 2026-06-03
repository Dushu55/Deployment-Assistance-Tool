import fs from 'fs';
import os from 'os';
import path from 'path';

// Shared, home-based report library (outside any git repo) that `dat scan` publishes to and
// `dat serve` hosts. Reports are a per-app vulnerability map, so everything here is owner-only
// (0700 dir / 0600 files) and bounded to the most recent RETENTION reports.

export const RETENTION = 100;
const DEFAULT_PORT = 4737;

export interface ReportSummary { critical: number; high: number; medium: number; low: number; info: number; }
export interface ReportEntry {
  slug: string;
  appName: string;
  file: string;          // basename, e.g. e-waste_staging-20260603-171800.html
  timestamp: string;     // ISO
  score: number;
  gate: 'pass' | 'fail';
  summary: ReportSummary;
}

export function datHome(): string {
  return process.env.DAT_HOME || path.join(os.homedir(), '.dat');
}
export function reportsDir(): string {
  return path.join(datHome(), 'reports');
}
export function serverPort(): number {
  const p = parseInt(process.env.DAT_PORT || '', 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}
function manifestPath(): string { return path.join(reportsDir(), 'index.json'); }

export function readManifest(): ReportEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function ensureDir(): string {
  const dir = reportsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir mode is masked by umask; force owner-only explicitly (reports are sensitive).
  try { fs.chmodSync(datHome(), 0o700); fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  return dir;
}

function slugify(name: string): string {
  return (name || 'app').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'app';
}
/** Compact, filesystem-safe stamp from an ISO timestamp: 2026-06-03T17:18:00.123Z -> 20260603-171800. */
export function compactStamp(iso: string): string {
  return iso.replace(/[-:T]/g, '').replace(/\..+$/, '').replace(/(\d{8})(\d{6})/, '$1-$2');
}

/**
 * Copy a freshly-generated HTML report into the library (owner-only), record it in the manifest,
 * prune to the newest RETENTION reports, and return the hosted URL.
 */
export function publishReport(opts: {
  htmlPath: string;
  appName: string;
  score: number;
  gate: 'pass' | 'fail';
  summary: ReportSummary;
  timestamp: string;
}): string {
  const dir = ensureDir();
  const slug = `${slugify(opts.appName)}-${compactStamp(opts.timestamp)}`;
  const file = `${slug}.html`;
  fs.writeFileSync(path.join(dir, file), fs.readFileSync(opts.htmlPath, 'utf8'), { mode: 0o600 });

  const entry: ReportEntry = {
    slug, appName: opts.appName, file, timestamp: opts.timestamp,
    score: opts.score, gate: opts.gate, summary: opts.summary
  };
  const entries = [entry, ...readManifest().filter(e => e.file !== file)];

  // Retention: keep the newest RETENTION; delete the older report files from disk.
  const removed = entries.splice(RETENTION);
  for (const e of removed) { try { fs.unlinkSync(path.join(dir, e.file)); } catch { /* already gone */ } }

  fs.writeFileSync(manifestPath(), JSON.stringify(entries, null, 2), { mode: 0o600 });
  return `http://localhost:${serverPort()}/r/${file}`;
}

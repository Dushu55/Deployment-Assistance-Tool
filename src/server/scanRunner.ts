import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { readOperatorEnv } from './operatorEnv.js';
import { gcloudStatus } from './gcloud.js';

/**
 * Runs `dat scan` as a child process and turns its stdout into a stream of structured events the UI
 * consumes over SSE. We shell out (rather than call runDatPipeline in-process) so the scan's target
 * `--path` cwd, long runtime, and any crash are fully isolated from the UI server, and so per-run
 * env (operator creds, and later ephemeral app secrets) is injected purely via the child's env.
 */
const ANSI = /\u001b\[[0-9;]*m/g;

export interface ScanResult {
  gate: 'pass' | 'fail' | null;
  score: number | null;
  reportFile: string | null;
}
export type ScanEvent =
  | { type: 'log'; line: string }
  | { type: 'scanner'; name: string; state: 'running' | 'skipped' }
  | { type: 'score'; score: number }
  | { type: 'gate'; gate: 'pass' | 'fail' }
  | { type: 'report'; file: string }
  | { type: 'end'; exitCode: number | null; result: ScanResult };

/** Classify one stdout line into a structured event (pure — unit-tested against a fixture). */
export function classifyLine(line: string): Exclude<ScanEvent, { type: 'log' } | { type: 'end' }> | null {
  const t = line.replace(ANSI, '').trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^➜ Running (.+?)\.\.\.$/))) return { type: 'scanner', name: m[1], state: 'running' };
  if ((m = t.match(/^⤼ Skipping (.+?) —/))) return { type: 'scanner', name: m[1], state: 'skipped' };
  if ((m = t.match(/Deployment Readiness Score:\s*(\d+)\s*\/\s*100/))) return { type: 'score', score: Number(m[1]) };
  if (/Quality Gate Failed/.test(t)) return { type: 'gate', gate: 'fail' };
  if (/Quality Gate Passed/.test(t)) return { type: 'gate', gate: 'pass' };
  if ((m = t.match(/Report published:\s*(\S+)/))) return { type: 'report', file: m[1].split('/').pop() || m[1] };
  return null;
}

interface Run {
  id: string;
  status: 'running' | 'done';
  events: ScanEvent[];
  emitter: EventEmitter;
  result: ScanResult;
  exitCode: number | null;
}

const runs = new Map<string, Run>();

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

function datEntry(): string {
  // dist/server/scanRunner.js -> dist/index.js
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
}

export interface StartScanOptions {
  target: string;
  profile?: string;
  url?: string;
  deploy?: boolean;
  /** With deploy: deploy the ephemeral preview public (no IAM token) so DAST can reach it. */
  allowUnauthenticated?: boolean;
  /** App-owner runtime secrets for a --deploy run: injected into the child env, never persisted. */
  appSecrets?: Record<string, string>;
}

export function startScan(opts: StartScanOptions): string {
  const id = crypto.randomBytes(9).toString('hex');
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const run: Run = { id, status: 'running', events: [], emitter, result: { gate: null, score: null, reportFile: null }, exitCode: null };
  runs.set(id, run);

  const args = [datEntry(), 'scan', '--path', opts.target, '--html', 'results/dat-report.html'];
  if (opts.profile) args.push('--profile', opts.profile);
  if (opts.url) args.push('--url', opts.url);
  else if (opts.deploy) {
    args.push('--deploy');
    if (opts.allowUnauthenticated) args.push('--allow-unauthenticated');
  }

  // Env precedence: process env < operator creds (~/.dat/.env) < this run's ephemeral app secrets.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...readOperatorEnv(), ...(opts.appSecrets ?? {}) };
  // The GCP deployer reads the project only from GCP_PROJECT_ID; operators usually set it via
  // `gcloud config set project`, so derive it from gcloud when absent for a deploy run.
  if (opts.deploy && !childEnv.GCP_PROJECT_ID && !childEnv.GOOGLE_CLOUD_PROJECT) {
    const project = gcloudStatus().project;
    if (project) childEnv.GCP_PROJECT_ID = project;
  }
  const child = spawn(process.execPath, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });

  const push = (e: ScanEvent) => { run.events.push(e); emitter.emit('event', e); };

  const handleLine = (raw: string) => {
    const clean = raw.replace(ANSI, '').replace(/\s+$/, '');
    if (clean) push({ type: 'log', line: clean });
    const ev = classifyLine(raw);
    if (ev) {
      push(ev);
      if (ev.type === 'score') run.result.score = ev.score;
      else if (ev.type === 'gate') run.result.gate = ev.gate;
      else if (ev.type === 'report') run.result.reportFile = ev.file;
    }
  };

  let buf = '';
  const onData = (chunk: Buffer) => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  };

  const finalize = (code: number | null) => {
    if (run.status === 'done') return;
    if (buf.trim()) { handleLine(buf); buf = ''; }
    run.status = 'done';
    run.exitCode = code;
    const end: ScanEvent = { type: 'end', exitCode: code, result: run.result };
    run.events.push(end);
    emitter.emit('event', end);
    emitter.emit('end', end);
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => { push({ type: 'log', line: `Failed to start scan: ${err.message}` }); finalize(null); });
  child.on('close', (code) => finalize(code));

  return id;
}

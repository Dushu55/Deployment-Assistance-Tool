import http from 'http';
import fs from 'fs';
import path from 'path';
import { reportsDir, readManifest, serverPort, ReportEntry } from './library.js';

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function renderIndex(entries: ReportEntry[]): string {
  const rows = entries.map(e => {
    const badge = e.gate === 'pass'
      ? '<span style="color:#137333;font-weight:600">PASS</span>'
      : '<span style="color:#c5221f;font-weight:600">FAIL</span>';
    const s = e.summary || { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    return `<tr><td><a href="/r/${esc(e.file)}">${esc(e.appName)}</a></td>` +
      `<td>${esc(e.timestamp)}</td><td>${badge}</td><td>${esc(e.score)}/100</td>` +
      `<td>${esc(s.critical)}C / ${esc(s.high)}H / ${esc(s.medium)}M / ${esc(s.low)}L</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DAT Reports</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;margin:2rem;color:#202124}
h1{font-size:1.4rem}table{border-collapse:collapse;width:100%;margin-top:1rem}
th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #eee}
th{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#80868b}
a{color:#1a73e8;text-decoration:none}a:hover{text-decoration:underline}.muted{color:#80868b;font-weight:400;font-size:.9rem}</style>
</head><body><h1>🛡️ DAT Reports <span class="muted">(local · ${entries.length})</span></h1>${
    entries.length === 0
      ? '<p class="muted">No reports yet. Run <code>dat scan</code> in an application directory.</p>'
      : `<table><thead><tr><th>Application</th><th>When</th><th>Gate</th><th>Score</th><th>Findings</th></tr></thead><tbody>${rows}</tbody></table>`
  }</body></html>`;
}

const VALID_FILE = /^[A-Za-z0-9._-]+\.html$/;

/**
 * Resolve a `/r/<name>.html` request path to an absolute file inside the reports dir, or null.
 * Strips path components (traversal), enforces the *.html allowlist, and confirms containment.
 * Shared by every server that exposes reports so the security boundary lives in one place.
 */
export function resolveReportFile(requestPath: string): string | null {
  const dir = reportsDir();
  const name = path.basename(requestPath.replace(/^\/r\//, ''));
  const full = path.join(dir, name);
  if (VALID_FILE.test(name) && full.startsWith(dir + path.sep) && fs.existsSync(full)) {
    return full;
  }
  return null;
}

/**
 * Resolve a report's structured findings sidecar from its HTML basename: validate against the
 * same `*.html` allowlist, swap the extension to `.json`, and confirm containment in the reports
 * dir. Returns the absolute path or null (also null when no sidecar exists, e.g. an older report).
 */
export function resolveReportSidecar(htmlBasename: string): string | null {
  const dir = reportsDir();
  const name = path.basename(htmlBasename);
  if (!VALID_FILE.test(name)) return null;
  const jsonName = name.replace(/\.html$/, '.json');
  const full = path.join(dir, jsonName);
  if (full.startsWith(dir + path.sep) && fs.existsSync(full)) return full;
  return null;
}

/**
 * Stream a report file to the response (with an error handler so a vanished/locked file can't
 * crash the process). Returns true if it served a file, false if the path didn't resolve (the
 * caller should then 404).
 */
export function serveReportFile(res: http.ServerResponse, requestPath: string): boolean {
  const full = resolveReportFile(requestPath);
  if (!full) return false;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  const stream = fs.createReadStream(full);
  stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
  stream.pipe(res);
  return true;
}

/** Pure request handler (no listener) so it can be unit-tested with mock req/res. */
export function createReportHandler() {
  return (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (req.method !== 'GET') { res.writeHead(405, { 'Content-Type': 'text/plain' }); res.end('Method Not Allowed'); return; }
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);

    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderIndex(readManifest()));
      return;
    }
    if (pathname === '/index.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readManifest(), null, 2));
      return;
    }
    if (pathname.startsWith('/r/') && serveReportFile(res, pathname)) {
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  };
}

/** Start the local report server, bound to loopback only (127.0.0.1). */
export function startReportServer(port: number = serverPort()): http.Server {
  const server = http.createServer(createReportHandler());
  server.listen(port, '127.0.0.1');
  return server;
}

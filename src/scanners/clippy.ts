import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import * as fs from 'fs';
import * as path from 'path';

export async function runClippy(workspaceRoot: string = process.cwd()): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;

  try {
    if (!fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
      return { scannerName: 'Clippy', success: true, durationMs: 0, issues: [], error: 'No Cargo.toml found. Skipping Clippy.' };
    }

    const cmd = 'cargo';
    // Use --message-format=json to parse natively. 
    // We add `-q` to avoid extraneous text, and `--all-targets` to check tests/benches too.
    const args = ['clippy', '-q', '--message-format=json', '--all-targets'];
    
    const result = await runCommand(cmd, args, 300000);
    durationMs = Date.now() - startTime;

    // cargo clippy exits with non-zero if errors are found, but warnings usually keep exit 0.
    // However, if the build utterly fails to compile, it will exit non-zero. 
    // We parse the JSON stream regardless.
    const lines = result.stdout.split('\n').filter(line => line.trim() !== '');

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.reason === 'compiler-message' && parsed.message) {
          const msg = parsed.message;
          // Ignore general info
          if (msg.level === 'warning' || msg.level === 'error') {
            const code = msg.code?.code || 'clippy-lint';
            
            // Extract primary location
            let file = 'unknown';
            let lineNum: number | undefined;
            if (msg.spans && msg.spans.length > 0) {
              const primarySpan = msg.spans.find((s: any) => s.is_primary) || msg.spans[0];
              file = primarySpan.file_name;
              lineNum = primarySpan.line_start;
            }

            issues.push({
              id: code,
              severity: mapSeverity(msg.level === 'error' ? 'HIGH' : 'MEDIUM'),
              message: msg.message,
              file: file,
              line: lineNum,
              source: 'Clippy'
            });
          }
        }
      } catch (e) {
        // Ignore non-json lines
      }
    }

    // If it failed to build entirely and we got no parsed issues, report the error
    if (result.exitCode !== 0 && issues.length === 0) {
        return { scannerName: 'Clippy', success: false, durationMs, issues: [], error: `cargo clippy failed: ${result.stderr}` };
    }

    return { scannerName: 'Clippy', success: true, durationMs, issues };

  } catch (err: any) {
    return {
      scannerName: 'Clippy',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const clippyScanner: Scanner = {
  name: 'Clippy',
  module: 'static',
  supportedLanguages: ['rust'],
  async run(ctx) {
    return runClippy(process.cwd());
  }
};

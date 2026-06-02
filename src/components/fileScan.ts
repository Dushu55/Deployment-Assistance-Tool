import fs from 'fs';
import path from 'path';

const DEFAULT_EXCLUDES = ['node_modules', 'dist', 'build', 'coverage', '.git', 'venv', '.next', 'out', 'target', '__pycache__', '.gemini', '.opencode', '.swc'];

/** Recursively collect files matching any of `includeExts`, skipping common build/vendor dirs. */
export function findFiles(root: string, includeExts: string[], excludeDirs: string[] = DEFAULT_EXCLUDES): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(root, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!excludeDirs.includes(entry)) {
        results.push(...findFiles(full, includeExts, excludeDirs));
      }
    } else if (includeExts.some(ext => entry.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

/** 1-based line number for a character offset within `content`. */
export function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** Path relative to the workspace root, with leading ./ removed. */
export function relPath(root: string, file: string): string {
  return path.relative(root, file).replace(/^\.\//, '') || file;
}

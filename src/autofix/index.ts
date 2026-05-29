import { promisify } from 'util';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../logger.js';
import { SupportedLanguage } from '../types.js';

const execFileAsync = promisify(execFile);

export interface AutoFixResult {
  ruleId: string;
  success: boolean;
  filesFixed: string[];
  reverted?: boolean;
  error?: string;
}

export class AstGrepAutoFixer {
  private workspaceRoot: string;
  private baseRulesDir: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.baseRulesDir = path.resolve(new URL(import.meta.url).pathname, '../../autofix/rules');
    if (!fs.existsSync(this.baseRulesDir)) {
       this.baseRulesDir = path.resolve(process.cwd(), 'src/autofix/rules');
    }
  }

  /**
   * Applies AST fixes from directories matching the detected languages.
   */
  async applyAllFixes(verifyCommand?: string, detectedLanguages: SupportedLanguage[] = ['node']): Promise<AutoFixResult[]> {
    if (!fs.existsSync(this.baseRulesDir)) {
      logger.warn(`AST rules directory not found at ${this.baseRulesDir}. Skipping auto-fix.`);
      return [];
    }

    const results: AutoFixResult[] = [];

    // Always run generic rules (if any exist in the root) and language-specific rules
    const targetDirs = ['.', ...detectedLanguages];

    for (const targetDir of targetDirs) {
      const rulesDir = path.join(this.baseRulesDir, targetDir);
      if (!fs.existsSync(rulesDir)) continue;

      const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      
      for (const ruleFile of ruleFiles) {
        const ruleId = path.basename(ruleFile, path.extname(ruleFile));
        const rulePath = path.join(rulesDir, ruleFile);
        
        const result = await this.applyFix(ruleId, rulePath, verifyCommand);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Runs an ast-grep scan WITHOUT modifying files to discover which files a rule matches.
   * This lets us snapshot originals before rewriting so we can revert without git.
   */
  private async discoverMatches(ruleId: string, rulePath: string): Promise<string[]> {
    let stdout = '';
    try {
      const result = await execFileAsync('npx', ['sg', 'scan', '--rule', rulePath, '--json', this.workspaceRoot]);
      stdout = result.stdout;
    } catch (execErr: any) {
      stdout = execErr.stdout || '';
    }
    const files = new Set<string>();
    if (stdout.trim()) {
      try {
        const matches = JSON.parse(stdout);
        if (Array.isArray(matches)) {
          matches.forEach((m: any) => { if (m.file) files.add(m.file); });
        }
      } catch (parseErr) {
        logger.warn(`Could not parse ast-grep discovery JSON for rule ${ruleId}: ${parseErr}`);
      }
    }
    return Array.from(files);
  }

  /**
   * Restores files from in-memory snapshots taken before the rewrite.
   * Git-independent: works in non-git checkouts where `git checkout` silently failed
   * and previously left broken auto-fixes in place.
   */
  private restoreSnapshots(snapshots: Map<string, string | null>): void {
    for (const [absPath, content] of snapshots) {
      if (content === null) continue; // file did not exist before the fix
      try {
        fs.writeFileSync(absPath, content);
      } catch (revertErr: any) {
        logger.error(`Failed to restore ${absPath}: ${revertErr.message}`);
      }
    }
  }

  /**
   * Applies a specific AST rule to rewrite code deterministically (ast-grep / sg),
   * guarded by a snapshot-based test-driven rollback loop.
   */
  async applyFix(ruleId: string, rulePath: string, verifyCommand?: string): Promise<AutoFixResult> {
    logger.info(`Running AST auto-fixer for rule: ${ruleId}`);
    try {
      // 1. Discover matches without mutating anything.
      const filesList = await this.discoverMatches(ruleId, rulePath);
      if (filesList.length === 0) {
        return { ruleId, success: true, filesFixed: [], reverted: false };
      }

      // 2. Snapshot originals so revert never depends on git being present.
      const snapshots = new Map<string, string | null>();
      for (const file of filesList) {
        const abs = path.resolve(this.workspaceRoot, file);
        try {
          snapshots.set(abs, fs.readFileSync(abs, 'utf8'));
        } catch {
          snapshots.set(abs, null);
        }
      }

      // 3. Validate the verify command BEFORE touching the tree. A missing or
      //    non-whitelisted command means we have no safety net, so we refuse to fix.
      const allowedCommands = ['npm test', 'pytest', 'go test ./...', 'cargo test', 'mvn test', 'gradle test', 'dotnet test'];
      if (!verifyCommand) {
        logger.warn(`No verifyCommand available for this ecosystem. Skipping auto-fix for ${ruleId} (no test safety net).`);
        return {
          ruleId,
          success: false,
          filesFixed: [],
          reverted: false,
          error: 'Missing verification command (verifyCommand is null). Auto-remediation requires a test safety net.'
        };
      }
      if (!allowedCommands.includes(verifyCommand)) {
        // SECURITY: block RCE via a malicious verifyCommand injected through .dat.config.yaml in a PR.
        logger.error(`SECURITY ALERT: Attempted to run unauthorized verify command: ${verifyCommand}. Blocking execution.`);
        return {
          ruleId,
          success: false,
          filesFixed: [],
          reverted: false,
          error: 'Unauthorized verify command. Only standard test frameworks are allowed.'
        };
      }

      // 4. Apply the rewrite.
      try {
        await execFileAsync('npx', ['sg', 'scan', '--rule', rulePath, '--update-all', '--json', this.workspaceRoot]);
      } catch (execErr: any) {
        // ast-grep exits non-zero when it finds/changes matches; that is expected.
      }
      logger.info(`AST Fix applied tentatively for ${ruleId} in ${filesList.length} file(s).`);

      // 5. Verify, reverting from snapshot on failure.
      logger.info(`Verifying fix for ${ruleId} using secure command: "${verifyCommand}"`);
      try {
        const [baseCmd, ...args] = verifyCommand.split(' ');
        await execFileAsync(baseCmd, args, { cwd: this.workspaceRoot, timeout: 60000 });
        logger.info(`Verification passed for ${ruleId}. Fix accepted.`);
        return { ruleId, success: true, filesFixed: filesList, reverted: false };
      } catch (verifyErr: any) {
        logger.warn(`Verification failed for ${ruleId}. Reverting ${filesList.length} file(s) from snapshot...`);
        this.restoreSnapshots(snapshots);
        return {
          ruleId,
          success: false,
          filesFixed: filesList,
          reverted: true,
          error: `Verification command failed: ${verifyErr.message}`
        };
      }
    } catch (error: any) {
      logger.error(`AST Auto-fix failed for rule ${ruleId}: ${error.message}`);
      return {
        ruleId,
        success: false,
        filesFixed: [],
        error: error.message
      };
    }
  }
}

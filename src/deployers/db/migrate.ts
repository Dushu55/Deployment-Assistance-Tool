import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { runCommand } from '../../runner.js';

/** Detect the app's migration command from its stack, or null when it can't be inferred. */
export function detectMigrateCommand(workspaceRoot: string): string | null {
  const has = (p: string) => fs.existsSync(path.join(workspaceRoot, p));
  if (has('prisma/schema.prisma') || has('schema.prisma')) return 'npx prisma migrate deploy';
  if (has('drizzle.config.ts') || has('drizzle.config.js') || has('drizzle.config.json')) return 'npx drizzle-kit migrate';
  // TypeORM/Sequelize/raw SQL have no universal invocation — require an explicit migrateCommand.
  return null;
}

/**
 * Apply the app's migrations (and optional seed) against the freshly provisioned DATABASE_URL so
 * the deployed preview has its schema. Best-effort: returns false (logged) on failure so the scan
 * can still proceed against an empty DB. Commands run as a plain argv (no shell), in the app dir,
 * with DATABASE_URL injected — keep `migrateCommand`/`seedCommand` simple (no shell operators).
 */
export async function runMigrations(opts: {
  workspaceRoot: string;
  databaseUrl: string;
  migrateCommand?: string;
  seedCommand?: string;
}): Promise<boolean> {
  const cmd = opts.migrateCommand || detectMigrateCommand(opts.workspaceRoot);
  if (!cmd) {
    logger.warn('No migration command detected (set deployer.database.migrateCommand) — preview will run against an unmigrated DB.');
    return false;
  }
  const env = { DATABASE_URL: opts.databaseUrl };
  const run = async (label: string, full: string) => {
    const [bin, ...args] = full.trim().split(/\s+/);
    logger.info(`Running ${label}: ${full}`);
    const res = await runCommand(bin, args, 300000, opts.workspaceRoot, env);
    if (res.exitCode !== 0) {
      throw new Error(`${label} failed (exit ${res.exitCode}): ${(res.stderr || res.stdout).trim().slice(0, 300)}`);
    }
  };
  try {
    await run('migration', cmd);
    if (opts.seedCommand) await run('seed', opts.seedCommand);
    return true;
  } catch (e: any) {
    logger.error(`Database migration failed: ${e.message}`);
    return false;
  }
}

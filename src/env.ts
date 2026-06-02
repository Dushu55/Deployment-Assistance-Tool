import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import { DatabaseEngine, DetectedDatabase } from './types.js';

export type SupportedLanguage = 'node' | 'python' | 'go' | 'java' | 'csharp' | 'rust';

export class EnvironmentDetector {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Detects the programming languages used in the repository by looking for standard ecosystem files.
   * Returns an array of detected languages. Can detect polyglot repositories.
   */
  detectLanguages(): SupportedLanguage[] {
    const detected = new Set<SupportedLanguage>();

    // Node.js
    if (this.fileExists('package.json') || this.fileExists('yarn.lock') || this.fileExists('pnpm-lock.yaml')) {
      detected.add('node');
    }

    // Python
    if (this.fileExists('requirements.txt') || this.fileExists('pyproject.toml') || this.fileExists('Pipfile')) {
      detected.add('python');
    }

    // Go
    if (this.fileExists('go.mod') || this.fileExists('go.sum')) {
      detected.add('go');
    }

    // Java
    if (this.fileExists('pom.xml') || this.fileExists('build.gradle') || this.fileExists('build.gradle.kts')) {
      detected.add('java');
    }

    // C#
    const files = fs.readdirSync(this.workspaceRoot);
    if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln'))) {
      detected.add('csharp');
    }

    // Rust
    if (this.fileExists('Cargo.toml')) {
      detected.add('rust');
    }

    const result = Array.from(detected);
    if (result.length > 0) {
      logger.info(`Detected languages in workspace: ${result.join(', ')}`);
    } else {
      logger.info('No specific language ecosystem detected (assuming generic workspace).');
    }
    
    return result;
  }

  /**
   * Determines the safest test command to run for verifying auto-fixes based on the detected language.
   * Defaults to 'npm test' if a JS ecosystem is present and no override is provided,
   * but falls back to other standards depending on what is detected.
   */
  getVerifyCommand(detectedLanguages: SupportedLanguage[]): string | null {
    if (detectedLanguages.includes('node')) {
      return 'npm test';
    }
    if (detectedLanguages.includes('python')) {
      return 'pytest'; // Industry standard default for Python
    }
    if (detectedLanguages.includes('go')) {
      return 'go test ./...';
    }
    if (detectedLanguages.includes('rust')) {
      return 'cargo test';
    }
    if (detectedLanguages.includes('java')) {
      return this.fileExists('pom.xml') ? 'mvn test' : 'gradle test';
    }
    if (detectedLanguages.includes('csharp')) {
      return 'dotnet test';
    }
    return null; // No safe verifiable command known
  }

  private fileExists(filename: string): boolean {
    return fs.existsSync(path.join(this.workspaceRoot, filename));
  }

  private readFileSafe(filename: string): string | null {
    try {
      return fs.readFileSync(path.join(this.workspaceRoot, filename), 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Infers which database engine(s) the app uses, so the ephemeral-deploy path can provision a
   * matching DB (roadmap) and the preflight can report it. Best-effort and deduplicated by engine;
   * the first piece of evidence found for an engine wins. Detection is heuristic, not exhaustive.
   */
  detectDatabases(): DetectedDatabase[] {
    const found = new Map<DatabaseEngine, string>();
    const add = (engine: DatabaseEngine, evidence: string) => {
      if (!found.has(engine)) found.set(engine, evidence);
    };

    // 1. Prisma schema datasource provider (most authoritative when present).
    const prisma = this.readFileSafe(path.join('prisma', 'schema.prisma'));
    if (prisma) {
      const m = prisma.match(/datasource\s+\w+\s*\{[^}]*?provider\s*=\s*["']([\w]+)["']/s);
      const providerMap: Record<string, DatabaseEngine> = {
        postgresql: 'postgres', cockroachdb: 'postgres', mysql: 'mysql', mariadb: 'mysql',
        sqlite: 'sqlite', mongodb: 'mongodb', sqlserver: 'sqlserver'
      };
      const engine = m && providerMap[m[1].toLowerCase()];
      if (engine) add(engine, 'prisma/schema.prisma datasource provider');
    }

    // 2. docker-compose service images.
    const compose = this.readFileSafe('docker-compose.yml') || this.readFileSafe('docker-compose.yaml');
    if (compose) {
      const imageMap: [RegExp, DatabaseEngine][] = [
        [/\b(postgres|postgis)\b/i, 'postgres'], [/\b(mysql|mariadb)\b/i, 'mysql'],
        [/\bmongo\b/i, 'mongodb'], [/\bredis\b/i, 'redis'], [/\b(mssql|sqlserver)\b/i, 'sqlserver']
      ];
      for (const [re, engine] of imageMap) if (re.test(compose)) add(engine, 'docker-compose.yml service image');
    }

    // 3. Node dependency drivers/ORMs.
    const pkgRaw = this.readFileSafe('package.json');
    if (pkgRaw) {
      try {
        const pkg = JSON.parse(pkgRaw);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const depMap: Record<string, DatabaseEngine> = {
          pg: 'postgres', postgres: 'postgres', 'pg-promise': 'postgres',
          mysql: 'mysql', mysql2: 'mysql',
          mongoose: 'mongodb', mongodb: 'mongodb',
          sqlite3: 'sqlite', 'better-sqlite3': 'sqlite',
          redis: 'redis', ioredis: 'redis',
          mssql: 'sqlserver', tedious: 'sqlserver'
        };
        for (const [dep, engine] of Object.entries(depMap)) if (deps[dep]) add(engine, `package.json dependency "${dep}"`);
      } catch { /* malformed package.json — skip */ }
    }

    // 4. Python dependency drivers.
    const pyDeps = (this.readFileSafe('requirements.txt') || '') + '\n' + (this.readFileSafe('pyproject.toml') || '');
    if (pyDeps.trim()) {
      const pyMap: [RegExp, DatabaseEngine][] = [
        [/\b(psycopg2|psycopg|asyncpg)\b/i, 'postgres'], [/\b(mysqlclient|pymysql|aiomysql)\b/i, 'mysql'],
        [/\bpymongo\b/i, 'mongodb'], [/\bredis\b/i, 'redis'], [/\bpyodbc\b/i, 'sqlserver']
      ];
      for (const [re, engine] of pyMap) if (re.test(pyDeps)) add(engine, 'Python dependency driver');
    }

    // 5. DATABASE_URL scheme in .env / .env.example.
    const env = (this.readFileSafe('.env') || '') + '\n' + (this.readFileSafe('.env.example') || '');
    const urlMatch = env.match(/DATABASE_URL\s*=\s*["']?(\w+):\/\//i);
    if (urlMatch) {
      const schemeMap: Record<string, DatabaseEngine> = {
        postgres: 'postgres', postgresql: 'postgres', mysql: 'mysql', mongodb: 'mongodb',
        'mongodb+srv': 'mongodb', redis: 'redis', sqlserver: 'sqlserver', mssql: 'sqlserver'
      };
      const engine = schemeMap[urlMatch[1].toLowerCase()];
      if (engine) add(engine, 'DATABASE_URL scheme in .env');
    }

    const result = Array.from(found.entries()).map(([engine, evidence]) => ({ engine, evidence }));
    if (result.length > 0) {
      logger.info(`Detected database engine(s): ${result.map(r => r.engine).join(', ')}`);
    }
    return result;
  }
}

/** One-line human summary of detected databases for the preflight/readiness output (or null). */
export function databaseSummaryLine(dbs: DetectedDatabase[]): string | null {
  if (!dbs || dbs.length === 0) return null;
  return dbs.map(d => `${d.engine} (${d.evidence})`).join(', ');
}

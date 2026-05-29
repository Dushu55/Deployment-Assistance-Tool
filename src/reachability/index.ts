import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
import { SupportedLanguage } from '../types.js';

export interface ReachabilityResult {
  packageName: string;
  isReachable: boolean;
  evidenceFiles?: string[];
}

export interface ReachabilityAnalyzer {
  checkPackage(packageName: string): Promise<ReachabilityResult>;
}

// Utility to recursively find files
function findFilesSync(dir: string, includeExts: string[], excludeDirs: string[]): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (!excludeDirs.includes(file)) {
        results = results.concat(findFilesSync(fullPath, includeExts, excludeDirs));
      }
    } else {
      if (includeExts.some(ext => file.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

export class NodeReachabilityAnalyzer implements ReachabilityAnalyzer {
  constructor(private workspaceRoot: string) {}

  async checkPackage(packageName: string): Promise<ReachabilityResult> {
    try {
      // (from|import|require)[\s\(]*['"`]packageName(/['"`]|['"`])
      const regex = new RegExp(`(from|import|require)[\\s\\(]*['"\`]${packageName}(/['"\`]|['"\`])`);
      const excludeDirs = ['node_modules', 'dist', 'build', 'coverage', '.git'];
      const includeExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
      
      const files = findFilesSync(this.workspaceRoot, includeExts, excludeDirs);
      const evidenceFiles: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        if (regex.test(content)) {
          evidenceFiles.push(file);
        }
      }
      
      return { packageName, isReachable: evidenceFiles.length > 0, evidenceFiles: evidenceFiles.length > 0 ? evidenceFiles : undefined };
    } catch (error: any) {
      logger.error(`Error running Node reachability for ${packageName}: ${error.message}`);
      return { packageName, isReachable: true };
    }
  }
}

export class PythonReachabilityAnalyzer implements ReachabilityAnalyzer {
  constructor(private workspaceRoot: string) {}

  async checkPackage(packageName: string): Promise<ReachabilityResult> {
    try {
      const regex = new RegExp(`^(import|from)\\s+${packageName}(\\s|\\.|$)`, 'm');
      const excludeDirs = ['venv', '.env', '__pycache__', '.git'];
      const includeExts = ['.py'];
      
      const files = findFilesSync(this.workspaceRoot, includeExts, excludeDirs);
      const evidenceFiles: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        if (regex.test(content)) {
          evidenceFiles.push(file);
        }
      }
      
      return { packageName, isReachable: evidenceFiles.length > 0, evidenceFiles: evidenceFiles.length > 0 ? evidenceFiles : undefined };
    } catch (error: any) {
      logger.error(`Error running Python reachability for ${packageName}: ${error.message}`);
      return { packageName, isReachable: true };
    }
  }
}

export class JavaReachabilityAnalyzer implements ReachabilityAnalyzer {
  constructor(private workspaceRoot: string) {}

  async checkPackage(packageName: string): Promise<ReachabilityResult> {
    try {
      // In Java, package names for vulnerabilities might be like 'org.springframework:spring-core'
      // We need to extract the group/artifact or just sanitize it to check for imports.
      // Usually, 'org.springframework' is enough.
      const safePackage = packageName.split(':')[0]; // remove artifact if maven coordinate
      const regex = new RegExp(`^import\\s+${safePackage.replace(/\./g, '\\.')}(\\.|\\s|;)`, 'm');
      const excludeDirs = ['.gradle', 'build', 'target', 'out', 'node_modules', '.git'];
      const includeExts = ['.java', '.kt', '.scala'];
      
      const files = findFilesSync(this.workspaceRoot, includeExts, excludeDirs);
      const evidenceFiles: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        if (regex.test(content)) {
          evidenceFiles.push(file);
        }
      }
      
      return { packageName, isReachable: evidenceFiles.length > 0, evidenceFiles: evidenceFiles.length > 0 ? evidenceFiles : undefined };
    } catch (error: any) {
      logger.error(`Error running Java reachability for ${packageName}: ${error.message}`);
      return { packageName, isReachable: true };
    }
  }
}

export class CSharpReachabilityAnalyzer implements ReachabilityAnalyzer {
  constructor(private workspaceRoot: string) {}

  async checkPackage(packageName: string): Promise<ReachabilityResult> {
    try {
      const regex = new RegExp(`^using\\s+${packageName.replace(/\./g, '\\.')}(\\.|\\s|;)`, 'm');
      const excludeDirs = ['bin', 'obj', 'packages', 'node_modules', '.git'];
      const includeExts = ['.cs'];
      
      const files = findFilesSync(this.workspaceRoot, includeExts, excludeDirs);
      const evidenceFiles: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        if (regex.test(content)) {
          evidenceFiles.push(file);
        }
      }
      
      return { packageName, isReachable: evidenceFiles.length > 0, evidenceFiles: evidenceFiles.length > 0 ? evidenceFiles : undefined };
    } catch (error: any) {
      logger.error(`Error running C# reachability for ${packageName}: ${error.message}`);
      return { packageName, isReachable: true };
    }
  }
}

export class RustReachabilityAnalyzer implements ReachabilityAnalyzer {
  constructor(private workspaceRoot: string) {}

  async checkPackage(packageName: string): Promise<ReachabilityResult> {
    try {
      // Rust crate names in code use underscores instead of hyphens (e.g. 'tokio-util' becomes 'tokio_util')
      const sanitizedName = packageName.replace(/-/g, '_');
      
      // Match `use crate_name::...`, `extern crate crate_name;`, or direct calls `crate_name::`
      const regex = new RegExp(`(use\\s+${sanitizedName}::|extern\\s+crate\\s+${sanitizedName};|${sanitizedName}::)`, 'm');
      const excludeDirs = ['target', 'node_modules', '.git'];
      const includeExts = ['.rs'];
      
      const files = findFilesSync(this.workspaceRoot, includeExts, excludeDirs);
      const evidenceFiles: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        if (regex.test(content)) {
          evidenceFiles.push(file);
        }
      }
      
      return { packageName, isReachable: evidenceFiles.length > 0, evidenceFiles: evidenceFiles.length > 0 ? evidenceFiles : undefined };
    } catch (error: any) {
      logger.error(`Error running Rust reachability for ${packageName}: ${error.message}`);
      return { packageName, isReachable: true };
    }
  }
}

export class ReachabilityEngine {
  private analyzers: ReachabilityAnalyzer[] = [];

  constructor(workspaceRoot: string = process.cwd(), activeLanguages: SupportedLanguage[] = ['node']) {
    if (activeLanguages.includes('node') || activeLanguages.length === 0) {
      this.analyzers.push(new NodeReachabilityAnalyzer(workspaceRoot));
    }
    if (activeLanguages.includes('python')) {
      this.analyzers.push(new PythonReachabilityAnalyzer(workspaceRoot));
    }
    if (activeLanguages.includes('java')) {
      this.analyzers.push(new JavaReachabilityAnalyzer(workspaceRoot));
    }
    if (activeLanguages.includes('csharp')) {
      this.analyzers.push(new CSharpReachabilityAnalyzer(workspaceRoot));
    }
    if (activeLanguages.includes('rust')) {
      this.analyzers.push(new RustReachabilityAnalyzer(workspaceRoot));
    }
  }

  async checkNodePackage(packageName: string): Promise<ReachabilityResult> {
    // Left for backward compatibility, but orchestrator will now use generic checkPackage
    return this.checkPackage(packageName);
  }

  async checkPackage(packageName: string): Promise<ReachabilityResult> {
    if (this.analyzers.length === 0) {
      return { packageName, isReachable: true }; // Fail open if no analyzer
    }

    const evidence: string[] = [];
    let isReachable = false;

    // Run all applicable language analyzers
    for (const analyzer of this.analyzers) {
       const res = await analyzer.checkPackage(packageName);
       if (res.isReachable) {
         isReachable = true;
         if (res.evidenceFiles) {
           evidence.push(...res.evidenceFiles);
         }
       }
    }

    return {
      packageName,
      isReachable,
      evidenceFiles: evidence.length > 0 ? evidence : undefined
    };
  }
}

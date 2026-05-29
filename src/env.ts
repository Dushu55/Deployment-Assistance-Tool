import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';

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
}

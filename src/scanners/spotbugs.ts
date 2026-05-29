import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import * as fs from 'fs';
import * as path from 'path';
import xml2js from 'xml2js';
import { logger } from '../logger.js';

export async function runSpotBugs(workspaceRoot: string = process.cwd()): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;

  try {
    const isMaven = fs.existsSync(path.join(workspaceRoot, 'pom.xml'));
    const isGradle = fs.existsSync(path.join(workspaceRoot, 'build.gradle')) || fs.existsSync(path.join(workspaceRoot, 'build.gradle.kts'));

    if (!isMaven && !isGradle) {
      return { scannerName: 'SpotBugs', success: true, durationMs: 0, issues: [], error: 'Neither pom.xml nor build.gradle found. Skipping SpotBugs.' };
    }

    // Attempt to run the build tool with spotbugs enabled
    // We assume the user has the spotbugs plugin configured, or we just try the default goals.
    const cmd = isMaven ? 'mvn' : 'gradle';
    const args = isMaven ? ['compile', 'spotbugs:spotbugs'] : ['spotbugsMain'];
    
    logger.info(`Running SpotBugs via ${cmd}...`);
    const result = await runCommand(cmd, args, 300000);
    durationMs = Date.now() - startTime;

    // SpotBugs might fail the build if bugs are found
    if (result.exitCode !== 0 && !result.stdout.includes('SpotBugs') && !result.stderr.includes('SpotBugs')) {
        return { scannerName: 'SpotBugs', success: false, durationMs, issues: [], error: `Build failed before or during SpotBugs execution: ${result.stderr}` };
    }

    // Find the XML output
    const reportPaths = isMaven 
        ? ['target/spotbugsXml.xml', 'target/spotbugs.xml'] 
        : ['build/reports/spotbugs/main.xml'];
    
    let reportPath = '';
    for (const p of reportPaths) {
        if (fs.existsSync(path.join(workspaceRoot, p))) {
            reportPath = path.join(workspaceRoot, p);
            break;
        }
    }

    if (!reportPath) {
        // Build succeeded but no report generated. Either no bugs, or plugin not configured.
        return { scannerName: 'SpotBugs', success: true, durationMs, issues };
    }

    const xmlData = fs.readFileSync(reportPath, 'utf-8');
    const parser = new xml2js.Parser({ explicitArray: false });
    const parsed = await parser.parseStringPromise(xmlData);

    const bugInstances = parsed.BugCollection?.BugInstance;
    if (bugInstances) {
        const bugs = Array.isArray(bugInstances) ? bugInstances : [bugInstances];
        
        for (const bug of bugs) {
            // Priority 1 = High, 2 = Medium, 3 = Low
            const priority = parseInt(bug.$.priority, 10);
            let severityStr = 'LOW';
            if (priority === 1) severityStr = 'HIGH';
            if (priority === 2) severityStr = 'MEDIUM';

            const sourceLine = bug.SourceLine ? (Array.isArray(bug.SourceLine) ? bug.SourceLine[0] : bug.SourceLine) : {};

            issues.push({
                id: bug.$.type,
                severity: mapSeverity(severityStr),
                message: bug.LongMessage || bug.ShortMessage || 'SpotBugs vulnerability found',
                file: sourceLine.$.sourcepath || 'unknown',
                line: parseInt(sourceLine.$.start, 10) || undefined,
                source: 'SpotBugs'
            });
        }
    }

    return { scannerName: 'SpotBugs', success: true, durationMs, issues };

  } catch (err: any) {
    return {
      scannerName: 'SpotBugs',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const spotbugsScanner: Scanner = {
  name: 'SpotBugs',
  module: 'static',
  supportedLanguages: ['java'],
  async run(ctx) {
    return runSpotBugs(process.cwd());
  }
};

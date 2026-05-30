import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';
import { AggregatedReport, Severity } from '../types.js';
import { calculateReadinessScore, explainReadinessScore } from '../utils.js';
import * as explain from '../explain.js';
import type { ReadinessLevel } from '../readiness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Everything a report needs to render, including the gate/score context the orchestrator holds. */
export interface ReportContext {
  report: AggregatedReport;
  score?: number;
  failedGate?: boolean;
  failOn?: Severity[];
  readinessLevel?: ReadinessLevel;
}

/** Render the shared EJS report to an HTML string (used by both HTML and PDF outputs). */
export function renderReportHtml(ctx: ReportContext): string {
  const templatePath = path.resolve(__dirname, 'templates/report.ejs');
  const templateStr = fs.readFileSync(templatePath, 'utf8');
  const failOn = ctx.failOn ?? ['CRITICAL', 'HIGH'];
  return ejs.render(templateStr, {
    report: ctx.report,
    failOn,
    score: ctx.score ?? calculateReadinessScore(ctx.report.summary),
    scoreInfo: explainReadinessScore(ctx.report.summary),
    gate: explain.explainGate(failOn, ctx.report.summary),
    readinessLevel: ctx.readinessLevel,
    explain,
    calculateReadinessScore
  });
}

/** Write a self-contained HTML report (no puppeteer — fast, shareable). */
export function generateHtml(ctx: ReportContext, outputPath: string = 'dat-report.html'): void {
  const html = renderReportHtml(ctx);
  const fullPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, html);
}

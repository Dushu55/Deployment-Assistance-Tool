import { escapeHtml, PageFragment } from '../render.js';
import {
  PIPELINE_OVERVIEW, SCORE_MODEL, GATE_EXPLANATION,
  SEVERITY_EXPLANATIONS, CATEGORY_EXPLANATIONS, TIER_EXPLANATIONS, READINESS_LEVEL_EXPLANATIONS,
} from '../../../explain.js';

// Help page — fully static, generated at render time from src/explain.ts (the single source of
// plain-English truth), so the wording never drifts from the reports.
export function helpPage(): PageFragment {
  const pipeline = PIPELINE_OVERVIEW.map((s) => `<li>${escapeHtml(s)}</li>`).join('');

  const bands = SCORE_MODEL.bands.map((b) =>
    `<tr><td><span class="chip ${escapeHtml(b.band)}">${escapeHtml(b.range)}</span></td><td>${escapeHtml(b.meaning)}</td></tr>`
  ).join('');
  const weights = Object.entries(SCORE_MODEL.weights).map(([sev, w]) =>
    `<tr><td><span class="badge sev-${escapeHtml(sev)}">${escapeHtml(sev)}</span></td><td>${escapeHtml(w)}</td></tr>`
  ).join('');

  const severities = Object.entries(SEVERITY_EXPLANATIONS).map(([sev, e]) =>
    `<tr><td><span class="badge sev-${escapeHtml(sev)}">${escapeHtml(sev)}</span></td><td>${escapeHtml(e.meaning)}</td><td>${escapeHtml(e.action)}</td></tr>`
  ).join('');

  const categories = Object.entries(CATEGORY_EXPLANATIONS).map(([, e]) =>
    `<tr><td><strong>${escapeHtml(e.label)}</strong></td><td>${escapeHtml(e.whatItMeans)}</td><td>${escapeHtml(e.whyItMatters)}</td></tr>`
  ).join('');

  const tiers = Object.entries(TIER_EXPLANATIONS).map(([tier, e]) =>
    `<tr><td><span class="pill ${escapeHtml(tier)}">${escapeHtml(e.label)}</span></td><td>${escapeHtml(e.meaning)}</td></tr>`
  ).join('');

  const levels = Object.entries(READINESS_LEVEL_EXPLANATIONS).map(([lvl, e]) =>
    `<tr><td><span class="badge lvl-${escapeHtml(lvl)}">${escapeHtml(e.title)}</span></td><td>${escapeHtml(e.meaning)}</td><td>${escapeHtml(e.nextStep)}</td></tr>`
  ).join('');

  const html = `
  <h1>Help — how to read DAT</h1>
  <p class="lede">Plain-English reference for everything the reports show. The same wording appears in
    the HTML/PDF reports and the fix manifest.</p>

  <div class="card"><h2>How a scan works</h2><ol class="pipeline">${pipeline}</ol></div>

  <div class="card"><h2>The readiness score</h2>
    <p class="hint">${escapeHtml(SCORE_MODEL.range)} · ${escapeHtml(SCORE_MODEL.formula)}</p>
    <p style="font-size:.86rem">${escapeHtml(SCORE_MODEL.notes)}</p>
    <div class="grid2">
      <div><h3 class="hint" style="text-transform:uppercase">Bands</h3>
        <table class="gloss"><tbody>${bands}</tbody></table></div>
      <div><h3 class="hint" style="text-transform:uppercase">Severity weights</h3>
        <table class="gloss"><tbody>${weights}</tbody></table></div>
    </div>
  </div>

  <div class="card"><h2>The quality gate</h2><p style="font-size:.9rem">${escapeHtml(GATE_EXPLANATION)}</p></div>

  <div class="card"><h2>Severities</h2>
    <table class="gloss"><thead><tr><th>Severity</th><th>Meaning</th><th>Action</th></tr></thead><tbody>${severities}</tbody></table>
  </div>

  <div class="card"><h2>Finding categories</h2>
    <table class="gloss"><thead><tr><th>Category</th><th>What it means</th><th>Why it matters</th></tr></thead><tbody>${categories}</tbody></table>
  </div>

  <div class="card"><h2>Input tiers (readiness preflight)</h2>
    <table class="gloss"><tbody>${tiers}</tbody></table>
  </div>

  <div class="card"><h2>Readiness levels</h2>
    <table class="gloss"><thead><tr><th>Level</th><th>Meaning</th><th>Next step</th></tr></thead><tbody>${levels}</tbody></table>
  </div>`;

  const js = `
  App.pages['help'] = {};`;

  return { id: 'help', html, js };
}

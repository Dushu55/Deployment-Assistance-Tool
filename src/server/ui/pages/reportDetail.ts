import { inlineJson, PageFragment } from '../render.js';
import { SCORE_MODEL } from '../../../explain.js';

// Drill-in view for one report (#/reports/<file>): executive summary first (verdict, score band
// meaning, severity KPIs, top risks, coverage gaps), full per-scanner findings below.
//
// ESCAPING RULE: no backticks / ${ in the client JS (string concat + var only).
export function reportDetailPage(): PageFragment {
  const html = `
  <p class="backlink"><a href="#/reports">← All reports</a></p>
  <div id="detailRoot"><p class="hint">Loading…</p></div>`;

  const js = `
  // ---- report detail ----
  var SCORE_BANDS = ${inlineJson(SCORE_MODEL.bands)};
  var DETAIL_FILE_RE = /^[A-Za-z0-9._-]+\\.html$/;

  function bandMeaning(score){
    var band = scoreBand(score);
    for (var i = 0; i < SCORE_BANDS.length; i++) if (SCORE_BANDS[i].band === band) return SCORE_BANDS[i].meaning;
    return '';
  }

  function verdictSentence(entry){
    var s = entry.summary || {};
    if (entry.gate === 'pass') return 'Quality gate passed — no findings at blocking severities. Deployment is permitted.';
    var parts = [];
    if (s.critical) parts.push(s.critical + ' CRITICAL');
    if (s.high) parts.push(s.high + ' HIGH');
    var what = parts.length ? parts.join(' and ') + ' finding' + ((s.critical || 0) + (s.high || 0) > 1 ? 's' : '') : 'blocking findings or scanner errors';
    return 'Quality gate failed — deployment blocked by ' + what + '.';
  }

  function renderDetail(entry, results){
    var s = entry.summary || { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    var html = '';

    // Executive summary
    html += '<h1>' + esc(entry.appName) + '</h1>';
    html += '<p class="lede">Scanned ' + esc(String(entry.timestamp).replace('T', ' ').slice(0, 19)) +
      ' · <a href="/r/' + esc(entry.file) + '" target="_blank">Open full HTML report ↗</a></p>';
    html += '<div class="card"><h2>Executive summary</h2>' +
      '<div class="exec">' +
      '<span class="scorebig">' + esc(entry.score) + '<span class="hint" style="font-size:1rem">/100</span></span>' +
      '<span class="chip ' + scoreBand(entry.score) + '">' + esc(bandMeaning(entry.score)) + '</span>' +
      (entry.gate === 'pass' ? '<span class="badge lvl-enterprise-grade">✅ GATE PASSED</span>'
                             : '<span class="badge lvl-not-production-safe">❌ GATE FAILED</span>') +
      '</div>' +
      '<p style="font-size:.92rem">' + esc(verdictSentence(entry)) + '</p>' +
      '<div class="sev-kpis">' +
      [['CRITICAL', s.critical], ['HIGH', s.high], ['MEDIUM', s.medium], ['LOW', s.low], ['INFO', s.info]].map(function(p){
        return '<div class="sev-kpi"><div class="n">' + esc(p[1] || 0) + '</div><div class="l"><span class="badge sev-' + p[0] + '" style="font-size:.62rem">' + p[0] + '</span></div></div>';
      }).join('') +
      '</div></div>';

    if (results === null) {
      html += '<div class="card"><p class="hint">Structured findings aren\\'t available for this report (it was generated before findings sidecars existed). Re-run the scan to enable the breakdown, or open the full HTML report above.</p></div>';
      $('detailRoot').innerHTML = html;
      return;
    }

    // Top risks (exclude INFO — informational notes are not risks)
    var all = [];
    results.forEach(function(r){ (r.issues || []).forEach(function(i){ if (i.severity !== 'INFO') all.push(i); }); });
    all.sort(function(a, b){ return (SEV_RANK[a.severity] || 9) - (SEV_RANK[b.severity] || 9); });
    if (all.length) {
      html += '<div class="card"><h2>Top risks</h2>' +
        all.slice(0, 5).map(renderFindingCard).join('') +
        (all.length > 5 ? '<p class="hint">' + (all.length - 5) + ' more below in the full findings.</p>' : '') +
        '</div>';
    }

    // Coverage gaps: skipped or errored scanners (an unverified area is not a safe one)
    var gaps = results.filter(function(r){ return r.skipped || r.error; });
    if (gaps.length) {
      html += '<div class="card"><h2>Coverage gaps</h2><p class="hint">These checks did not run — the related risk areas are unverified, not necessarily safe.</p><ul class="checklist">' +
        gaps.map(function(r){
          return '<li><span class="skip">⤼</span><span>' + esc(r.scannerName) + '</span> <span class="hint">— ' + esc(r.skipReason || r.error || 'unavailable') + '</span></li>';
        }).join('') + '</ul></div>';
    }

    // Full per-scanner findings
    html += '<div class="card"><h2>All findings by scanner</h2>' + renderFindingsBody(results) + '</div>';
    $('detailRoot').innerHTML = html;
  }

  function showDetail(file){
    if (!file || !DETAIL_FILE_RE.test(file)) {
      $('detailRoot').innerHTML = '<div class="err">Unknown report.</div>';
      return;
    }
    var findEntry = function(){ return (App.reportsCache || []).filter(function(e){ return e.file === file; })[0]; };
    var render = function(entry){ fetchFindings(file).then(function(results){ renderDetail(entry, results); }); };
    var refetch = function(){
      api('/api/reports').then(function(r){ return r.json(); }).then(function(list){
        App.reportsCache = list || [];
        App.reportsDirty = false;
        var entry = findEntry();
        if (entry) render(entry);
        else $('detailRoot').innerHTML = '<div class="err">Report not found in the library (it may have been pruned).</div>';
      }).catch(function(){ $('detailRoot').innerHTML = '<div class="err">Could not load the report list.</div>'; });
    };
    // The cache can be stale (e.g. a scan just published a new report) — refetch on any miss.
    var entry = (!App.reportsDirty && App.reportsCache) ? findEntry() : null;
    if (entry) render(entry); else refetch();
  }

  App.pages['report-detail'] = { onShow: showDetail };`;

  return { id: 'report-detail', html, js };
}

import { PageFragment } from '../render.js';

// Landing page: portfolio KPIs + per-app trends from the report manifest (client-side only).
//
// ESCAPING RULE: no backticks / ${ in the client JS (string concat + var only).
export function reportsPage(): PageFragment {
  const html = `
  <h1>Reports</h1>
  <p class="lede">Scan history and readiness across every app on this machine. Click an app or scan to open its report.</p>
  <div class="kpis" id="repKpis"></div>
  <div class="card">
    <div class="toolbar">
      <input id="repFilter" type="text" placeholder="Filter by app name…" />
      <span class="seg">
        <button id="repViewApps" class="on">By app</button>
        <button id="repViewAll">All scans</button>
      </span>
    </div>
    <div id="reportsView"><p class="hint">No reports yet — run a scan from the New Scan page.</p></div>
  </div>`;

  const js = `
  // ---- reports overview ----
  var repView = 'apps';

  function loadReports(force){
    if (!force && App.reportsCache && !App.reportsDirty) { renderReportsPage(App.reportsCache); return; }
    api('/api/reports').then(function(r){ return r.json(); }).then(function(list){
      App.reportsCache = Array.isArray(list) ? list : [];
      App.reportsDirty = false;
      renderReportsPage(App.reportsCache);
    }).catch(function(){});
  }

  function groupByApp(list){
    // Defensive newest-first sort, then group preserving recency order.
    var sorted = list.slice().sort(function(a, b){ return String(b.timestamp).localeCompare(String(a.timestamp)); });
    var byApp = {}, order = [];
    sorted.forEach(function(e){
      if (!byApp[e.appName]) { byApp[e.appName] = []; order.push(e.appName); }
      byApp[e.appName].push(e);
    });
    return { byApp: byApp, order: order, sorted: sorted };
  }

  function sparkline(scoresNewestFirst){
    var scores = scoresNewestFirst.slice(0, 12).reverse();
    if (scores.length < 2) return '';
    var w = 80, h = 24, pad = 2;
    var step = (w - pad * 2) / (scores.length - 1);
    var pts = scores.map(function(s, i){
      var x = pad + i * step;
      var y = h - pad - (Math.max(0, Math.min(100, s)) / 100) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var last = pts[pts.length - 1].split(',');
    return '<svg class="spark ' + scoreBand(scores[scores.length - 1]) + '" viewBox="0 0 80 24" width="80" height="24" aria-hidden="true">' +
      '<polyline fill="none" stroke="currentColor" stroke-width="1.5" points="' + pts.join(' ') + '"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2" fill="currentColor"/></svg>';
  }

  function deltaHtml(latest, previous){
    if (previous == null) return '';
    var d = latest - previous;
    if (d > 0) return '<span class="delta-up">▲ +' + d + '</span>';
    if (d < 0) return '<span class="delta-down">▼ ' + d + '</span>';
    return '<span class="delta-flat">±0</span>';
  }

  function bandChip(score){
    return '<span class="chip ' + scoreBand(score) + '">' + esc(score) + '/100</span>';
  }
  function gateBadge(gate){
    return gate === 'pass' ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>';
  }

  function renderKpis(list){
    var g = groupByApp(list);
    var passCount = list.filter(function(e){ return e.gate === 'pass'; }).length;
    var avg = list.length ? Math.round(list.reduce(function(a, e){ return a + (e.score || 0); }, 0) / list.length) : 0;
    var latest = g.sorted[0];
    var cells = [
      { v: g.order.length, l: 'Apps scanned' },
      { v: list.length, l: 'Total scans' },
      { v: list.length ? Math.round(100 * passCount / list.length) + '%' : '—', l: 'Gate pass rate' },
      { v: list.length ? avg : '—', l: 'Average score' },
      { v: latest ? latest.score : '—', l: 'Latest score' }
    ];
    $('repKpis').innerHTML = cells.map(function(c){
      return '<div class="kpi"><div class="kv">' + esc(c.v) + '</div><div class="kl">' + esc(c.l) + '</div></div>';
    }).join('');
  }

  function renderReportsPage(list){
    renderKpis(list);
    var filter = ($('repFilter').value || '').toLowerCase();
    var filtered = filter ? list.filter(function(e){ return e.appName.toLowerCase().indexOf(filter) >= 0; }) : list;
    if (!filtered.length) {
      $('reportsView').innerHTML = '<p class="hint">' + (list.length ? 'No apps match the filter.' : 'No reports yet — run a scan from the New Scan page.') + '</p>';
      return;
    }
    if (repView === 'apps') renderAppsView(filtered); else renderAllView(filtered);
  }

  function renderAppsView(list){
    var g = groupByApp(list);
    $('reportsView').innerHTML = g.order.map(function(app){
      var entries = g.byApp[app];
      var latest = entries[0];
      var prev = entries.length > 1 ? entries[1].score : null;
      var scores = entries.map(function(e){ return e.score; });
      return '<div class="approw">' +
        '<span class="appname"><a href="#/reports/' + esc(latest.file) + '">' + esc(app) + '</a></span>' +
        sparkline(scores) +
        bandChip(latest.score) + deltaHtml(latest.score, prev) + gateBadge(latest.gate) +
        '<span class="stat">' + entries.length + ' scan' + (entries.length > 1 ? 's' : '') + '</span>' +
        '<span class="stat">' + esc(String(latest.timestamp).replace('T', ' ').slice(0, 16)) + '</span>' +
        '<span class="stat"><a href="/r/' + esc(latest.file) + '" target="_blank">Open HTML ↗</a></span>' +
        '</div>';
    }).join('');
  }

  function renderAllView(list){
    var g = groupByApp(list);
    var prevByApp = {};
    var rows = g.sorted.map(function(e){
      // Delta vs the next-older scan of the same app (list is newest-first).
      var idx = g.byApp[e.appName].indexOf(e);
      var prev = g.byApp[e.appName][idx + 1];
      return '<tr><td><a href="#/reports/' + esc(e.file) + '">' + esc(e.appName) + '</a></td>' +
        '<td>' + esc(String(e.timestamp).replace('T', ' ').slice(0, 16)) + '</td>' +
        '<td>' + gateBadge(e.gate) + '</td>' +
        '<td>' + bandChip(e.score) + ' ' + deltaHtml(e.score, prev ? prev.score : null) + '</td>' +
        '<td><a href="/r/' + esc(e.file) + '" target="_blank">Open HTML ↗</a></td></tr>';
    }).join('');
    $('reportsView').innerHTML = '<table class="reports"><thead><tr><th>App</th><th>When</th><th>Gate</th><th>Score</th><th>Report</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  $('repFilter').addEventListener('input', function(){ if (App.reportsCache) renderReportsPage(App.reportsCache); });
  $('repViewApps').addEventListener('click', function(){
    repView = 'apps'; this.classList.add('on'); $('repViewAll').classList.remove('on');
    if (App.reportsCache) renderReportsPage(App.reportsCache);
  });
  $('repViewAll').addEventListener('click', function(){
    repView = 'all'; this.classList.add('on'); $('repViewApps').classList.remove('on');
    if (App.reportsCache) renderReportsPage(App.reportsCache);
  });

  App.pages['reports'] = { onShow: function(){ loadReports(); } };`;

  return { id: 'reports', html, js };
}

// Shared client-side JS for every page: token bootstrap, api(), DOM helpers, prefs,
// the hash router, the findings modal, and finding-card rendering.
//
// ESCAPING RULE: this string is embedded in a TS template literal — NO backticks, NO ${ in the
// client code. String concat + var only. (See src/server/ui/render.ts.)
export const CORE_JS = `
  // --- session token bootstrap (preserve the hash so tokened deep links keep their route) ---
  var params = new URLSearchParams(location.search);
  var t = params.get('t');
  if (t) { sessionStorage.setItem('datToken', t); history.replaceState({}, '', location.pathname + location.hash); }
  var TOKEN = sessionStorage.getItem('datToken') || '';

  function api(path, opts){
    opts = opts || {};
    opts.headers = Object.assign({ 'X-DAT-Token': TOKEN, 'Content-Type':'application/json' }, opts.headers||{});
    return fetch(path, opts);
  }
  var $ = function(id){ return document.getElementById(id); };
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  // --- local preferences (operator machine only) ---
  function getPrefs(){ try { return JSON.parse(localStorage.getItem('datPrefs') || '{}'); } catch(_) { return {}; } }
  function setPrefs(patch){
    var p = getPrefs();
    Object.keys(patch).forEach(function(k){ p[k] = patch[k]; });
    try { localStorage.setItem('datPrefs', JSON.stringify(p)); } catch(_) {}
  }

  // --- app state + hash router ---
  var App = { pages: {}, scanRunning: false, reportsCache: null, reportsDirty: false, modulesCache: null };
  function parseRoute(){
    var h = location.hash.replace(/^#\\/?/, '');
    var seg = h.split('/');
    return { page: seg[0] || 'reports', param: seg.slice(1).join('/') || null };
  }
  function route(){
    var r = parseRoute();
    var id = r.page;
    if (id === 'reports' && r.param) id = 'report-detail';
    if (!App.pages[id]) { id = 'reports'; r.param = null; }
    var secs = document.querySelectorAll('.page');
    for (var i = 0; i < secs.length; i++) secs[i].classList.add('hidden');
    var el = $('page-' + id);
    if (el) el.classList.remove('hidden');
    var navId = (id === 'report-detail') ? 'reports' : id;
    var links = document.querySelectorAll('nav.sidebar a[data-nav]');
    for (var j = 0; j < links.length; j++) {
      links[j].classList.toggle('active', links[j].getAttribute('data-nav') === navId);
    }
    var p = App.pages[id];
    if (p && p.onShow) p.onShow(r.param);
  }
  App.start = function(){
    if (!location.hash) location.replace('#/reports');
    window.addEventListener('hashchange', route);
    route();
  };

  // --- score band helper (mirrors SCORE_MODEL bands) ---
  function scoreBand(score){ return score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red'; }

  // --- structured findings (sidecar) ---
  var SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  function fetchFindings(file){
    // null = sidecar missing (pre-sidecar report); [] = present but empty.
    return api('/api/findings?file=' + encodeURIComponent(file))
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; });
  }
  function renderFindingCard(i){
    var loc = i.file ? '<div class="f-loc">' + esc(i.file) + (i.line ? ':' + esc(i.line) : '') + '</div>' : '';
    var rem = i.remediation ? '<div class="f-rem"><strong>Fix:</strong> ' + esc(i.remediation) + '</div>' : '';
    return '<div class="finding">' +
      '<div class="f-head"><span class="badge sev-' + esc(i.severity) + '">' + esc(i.severity) + '</span> ' +
      '<span class="f-id">' + esc(i.id) + '</span><span class="f-src">' + esc(i.source || '') + '</span></div>' +
      '<div class="f-msg">' + esc(i.message) + '</div>' + loc + rem + '</div>';
  }
  function renderFindingsBody(results){
    if (!results || !results.length) return '<p class="hint">No findings recorded for this scan.</p>';
    return results.map(function(r){
      var head = '<h3 class="fg-scanner">' + esc(r.scannerName) + '</h3>';
      if (r.skipped) return head + '<p class="hint">Skipped — ' + esc(r.skipReason || 'unavailable') + '</p>';
      if (r.error) return head + '<p class="bad">Error: ' + esc(r.error) + '</p>';
      var issues = r.issues || [];
      if (!issues.length) return head + '<p class="hint">✓ No findings.</p>';
      return head + issues.map(renderFindingCard).join('');
    }).join('');
  }

  // --- findings modal (used by the live scan progress list) ---
  function openFindingsModal(title, results){
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = renderFindingsBody(results);
    $('findingsModal').classList.remove('hidden');
  }
  function closeFindingsModal(){ $('findingsModal').classList.add('hidden'); }
  $('modalClose').addEventListener('click', closeFindingsModal);
  $('findingsModal').addEventListener('click', function(e){ if (e.target === this) closeFindingsModal(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeFindingsModal(); });
`;

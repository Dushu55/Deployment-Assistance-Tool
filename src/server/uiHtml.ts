// The DAT control-panel SPA — a single self-contained HTML document (no build step, no external
// assets, so it works offline and under a strict environment). Served by src/server/ui.ts at `/`.
// The session token arrives via `?t=...` (printed in the terminal), is stashed in sessionStorage,
// stripped from the URL, and sent as `X-DAT-Token` on every /api call.

export function renderUiHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DAT Control Panel</title>
<style>
  :root {
    --bg:#f6f7f9; --card:#fff; --ink:#1f2933; --muted:#6b7785; --line:#e4e8ee;
    --brand:#2C3E50; --accent:#1a73e8; --green:#137333; --amber:#b8860b; --red:#c5221f;
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  header { background:var(--brand); color:#fff; padding:18px 24px; }
  header h1 { margin:0; font-size:1.15rem; font-weight:600; }
  header p { margin:4px 0 0; font-size:.85rem; opacity:.8; }
  main { max-width:980px; margin:0 auto; padding:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:18px; }
  .card h2 { margin:0 0 12px; font-size:1rem; }
  label { display:block; font-size:.8rem; color:var(--muted); margin-bottom:4px; }
  input[type=text], select { width:100%; padding:9px 11px; border:1px solid var(--line); border-radius:8px; font-size:.92rem; background:#fff; color:var(--ink); }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  .row > div { flex:1; min-width:180px; }
  button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:10px 16px; font-size:.9rem; font-weight:600; cursor:pointer; }
  button:hover { filter:brightness(.95); }
  button.secondary { background:#eef1f5; color:var(--ink); }
  .badge { display:inline-block; padding:4px 10px; border-radius:999px; font-size:.78rem; font-weight:700; }
  .lvl-not-production-safe { background:#fdecea; color:var(--red); }
  .lvl-production-safe { background:#fff4e0; color:var(--amber); }
  .lvl-enterprise-grade { background:#e6f4ea; color:var(--green); }
  .pill { display:inline-block; font-size:.7rem; padding:2px 8px; border-radius:999px; margin-left:6px; }
  .pill.critical { background:#fdecea; color:var(--red); }
  .pill.highly-advised { background:#fff4e0; color:var(--amber); }
  .pill.best-practice { background:#eef1f5; color:var(--muted); }
  ul.checklist { list-style:none; margin:0; padding:0; }
  ul.checklist li { padding:8px 0; border-bottom:1px solid var(--line); font-size:.9rem; display:flex; align-items:center; gap:8px; }
  ul.checklist li:last-child { border-bottom:0; }
  .ok { color:var(--green); } .bad { color:var(--red); }
  .muted { color:var(--muted); }
  .hint { font-size:.78rem; color:var(--muted); }
  code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  pre.cmd { background:#0f172a; color:#e2e8f0; padding:14px; border-radius:8px; overflow:auto; font-size:.82rem; white-space:pre-wrap; word-break:break-all; }
  .err { background:#fdecea; color:var(--red); padding:10px 12px; border-radius:8px; font-size:.88rem; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:760px){ .grid2 { grid-template-columns:1fr; } }
  .hidden { display:none; }
  table.reports { width:100%; border-collapse:collapse; font-size:.86rem; }
  table.reports th, table.reports td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); }
  table.reports th { font-size:.7rem; text-transform:uppercase; color:var(--muted); letter-spacing:.04em; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .btnrow { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:12px; }
  ul.scanners { list-style:none; margin:12px 0 0; padding:0; }
  ul.scanners li { padding:5px 0; font-size:.88rem; display:flex; gap:8px; align-items:center; }
  .spin { color:var(--accent); } .skip { color:var(--muted); }
  pre.logtail { background:#0f172a; color:#cbd5e1; padding:12px; border-radius:8px; font-size:.76rem; max-height:200px; overflow:auto; margin-top:12px; white-space:pre-wrap; }
  .result { margin-top:14px; padding:12px 14px; border-radius:8px; font-weight:600; font-size:.95rem; }
  .result.pass { background:#e6f4ea; color:var(--green); }
  .result.fail { background:#fdecea; color:var(--red); }
  .settings-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; margin:10px 0; }
  @media (max-width:760px){ .settings-grid { grid-template-columns:1fr; } }
  .settings-grid label { font-size:.78rem; }
  .settings-grid input { padding:7px 9px; }
  .setpill { font-size:.66rem; color:var(--green); margin-left:6px; }
</style>
</head>
<body>
<header>
  <h1>🛡️ DAT Control Panel</h1>
  <p>Point at an app, see what a scan needs, and view reports — all locally.</p>
</header>
<main>
  <div class="card">
    <h2>1 · Target application</h2>
    <div class="row">
      <div style="flex:3">
        <label>Absolute path to the app directory</label>
        <input id="path" type="text" placeholder="/Users/you/Projects/your-app" />
      </div>
      <div style="flex:0; display:flex; align-items:flex-end;">
        <button id="analyze">Analyze</button>
      </div>
    </div>
    <div id="targetErr" class="err hidden" style="margin-top:12px"></div>
    <p id="targetInfo" class="hint" style="margin-top:12px"></p>
  </div>

  <div id="config" class="card hidden">
    <h2>2 · Scan options</h2>
    <div class="row">
      <div>
        <label>Profile</label>
        <select id="profile">
          <option value="">(config default)</option>
          <option value="quick">quick</option>
          <option value="standard" selected>standard</option>
          <option value="security">security</option>
          <option value="full">full</option>
        </select>
      </div>
      <div>
        <label>DAST target</label>
        <select id="dast">
          <option value="none" selected>none (static + tests)</option>
          <option value="url">a running URL</option>
          <option value="deploy">ephemeral deploy</option>
        </select>
      </div>
      <div id="urlWrap" class="hidden">
        <label>URL</label>
        <input id="url" type="text" placeholder="http://localhost:3000" />
      </div>
    </div>
  </div>

  <div id="readiness" class="card hidden">
    <h2>3 · Readiness <span id="lvl"></span></h2>
    <div class="grid2">
      <div>
        <h3 style="font-size:.85rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em;">App inputs</h3>
        <ul id="inputs" class="checklist"></ul>
      </div>
      <div>
        <h3 style="font-size:.85rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em;">Required tools</h3>
        <ul id="tools" class="checklist"></ul>
      </div>
    </div>
  </div>

  <div id="dastPanel" class="card hidden">
    <h2>3b · Dynamic scan setup</h2>
    <div id="dastNotes" class="hint"></div>
    <div id="operatorNeeds"></div>
    <div id="appSecrets"></div>
  </div>

  <div id="cmd" class="card hidden">
    <h2>4 · Run it</h2>
    <div class="btnrow">
      <button id="runBtn">▶ Run scan</button>
      <span id="runStatus" class="hint"></span>
    </div>
    <pre class="cmd" id="cmdText" style="margin-top:12px"></pre>
    <button class="secondary" id="copyCmd">Copy command</button>

    <div id="progress" class="hidden">
      <ul id="scanners" class="scanners"></ul>
      <div id="result" class="hidden"></div>
      <details style="margin-top:12px"><summary class="hint">Scan log</summary>
        <pre class="logtail" id="logtail"></pre>
      </details>
    </div>
  </div>

  <div class="card">
    <h2>⚙️ DAT settings <span class="hint">— operator credentials</span></h2>
    <p class="hint">Stored once in <code>~/.dat/.env</code> (chmod 600) and injected into scans. Needed
      only for <code>--deploy</code> (Neon/GCP) and LLM / integration pushes — not for static scans.</p>
    <div id="settings" class="settings-grid"></div>
    <div class="btnrow">
      <button class="secondary" id="saveSettings">Save settings</button>
      <span id="settingsMsg" class="hint"></span>
    </div>
  </div>

  <div class="card">
    <h2>📰 Recent reports</h2>
    <div id="reports"><p class="hint">No reports yet.</p></div>
  </div>
</main>

<script>
(function(){
  // --- session token bootstrap ---
  var params = new URLSearchParams(location.search);
  var t = params.get('t');
  if (t) { sessionStorage.setItem('datToken', t); history.replaceState({}, '', location.pathname); }
  var TOKEN = sessionStorage.getItem('datToken') || '';

  function api(path, opts){
    opts = opts || {};
    opts.headers = Object.assign({ 'X-DAT-Token': TOKEN, 'Content-Type':'application/json' }, opts.headers||{});
    return fetch(path, opts);
  }
  var $ = function(id){ return document.getElementById(id); };
  var state = { path:null };

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  $('dast').addEventListener('change', function(){
    $('urlWrap').classList.toggle('hidden', this.value !== 'url');
    refreshReadiness(); refreshDast();
  });
  $('profile').addEventListener('change', function(){ refreshReadiness(); refreshDast(); });
  $('url').addEventListener('change', function(){ refreshReadiness(); refreshDast(); });

  $('analyze').addEventListener('click', analyze);
  $('path').addEventListener('keydown', function(e){ if (e.key === 'Enter') analyze(); });

  function analyze(){
    var p = $('path').value.trim();
    $('targetErr').classList.add('hidden');
    if (!p) return;
    api('/api/target', { method:'POST', body: JSON.stringify({ path: p }) })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (!res.ok) { showErr(res.j.error || 'Could not analyze that path.'); return; }
        state.path = res.j.path;
        var langs = (res.j.languages||[]).join(', ') || 'none detected';
        var db = res.j.dbSummary ? (' · DB: ' + res.j.dbSummary) : '';
        $('targetInfo').textContent = 'Detected: ' + langs + db;
        $('config').classList.remove('hidden');
        refreshReadiness();
      })
      .catch(function(){ showErr('Network error.'); });
  }
  function showErr(m){ var e=$('targetErr'); e.textContent=m; e.classList.remove('hidden'); }

  function refreshReadiness(){
    if (!state.path) return;
    var q = new URLSearchParams();
    q.set('path', state.path);
    if ($('profile').value) q.set('profile', $('profile').value);
    var dast = $('dast').value;
    if (dast === 'deploy') q.set('deploy', '1');
    if (dast === 'url' && $('url').value.trim()) q.set('url', $('url').value.trim());
    api('/api/readiness?' + q.toString())
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (!res.ok) { showErr(res.j && res.j.error ? res.j.error : 'Could not load readiness.'); return; }
        renderReadiness(res.j);
      })
      .catch(function(){ showErr('Could not load readiness.'); });
  }

  function renderReadiness(d){
    $('readiness').classList.remove('hidden');
    $('cmd').classList.remove('hidden');
    var lvl = $('lvl');
    lvl.className = 'badge lvl-' + d.readinessLevel;
    lvl.textContent = ({'not-production-safe':'⛔ NOT PRODUCTION-SAFE','production-safe':'🟡 PRODUCTION-SAFE','enterprise-grade':'✅ ENTERPRISE-GRADE'})[d.readinessLevel] || d.readinessLevel;

    $('inputs').innerHTML = (d.inputs.length ? d.inputs : [{label:'No input-gated scanners selected',present:true,tier:'best-practice'}])
      .map(function(i){
        return '<li><span class="'+(i.present?'ok':'bad')+'">'+(i.present?'✓':'✗')+'</span>'+
          '<span>'+esc(i.label)+'</span><span class="pill '+i.tier+'">'+i.tier+'</span></li>';
      }).join('');

    $('tools').innerHTML = d.tools.length ? d.tools.map(function(t){
      return '<li><span class="'+(t.present?'ok':'bad')+'">'+(t.present?'✓':'✗')+'</span>'+
        '<span>'+esc(t.binary)+'</span>'+(t.present?'':' <span class="hint">— '+esc(t.hint||'install to enable')+'</span>')+'</li>';
    }).join('') : '<li class="muted">No external tools required for the selected scanners.</li>';

    $('cmdText').textContent = d.command;
  }

  $('copyCmd').addEventListener('click', function(){
    navigator.clipboard && navigator.clipboard.writeText($('cmdText').textContent);
    this.textContent = 'Copied!';
    var b=this; setTimeout(function(){ b.textContent='Copy command'; }, 1200);
  });

  // ---- dynamic-scan setup (operator creds + app .env secrets) ----
  function refreshDast(){
    var dast = $('dast').value;
    if (dast === 'none' || !state.path) { $('dastPanel').classList.add('hidden'); return; }
    var q = new URLSearchParams(); q.set('path', state.path);
    if ($('profile').value) q.set('profile', $('profile').value);
    if (dast === 'deploy') q.set('deploy', '1');
    if (dast === 'url' && $('url').value.trim()) q.set('url', $('url').value.trim());
    api('/api/secrets-plan?' + q.toString()).then(function(r){ return r.json(); }).then(renderDast).catch(function(){});
  }

  function renderDast(plan){
    $('dastPanel').classList.remove('hidden');
    var deploy = $('dast').value === 'deploy';
    $('dastNotes').innerHTML = (plan.notes || []).map(function(n){ return '• ' + esc(n); }).join('<br>');

    if (deploy && plan.operator && plan.operator.length){
      $('operatorNeeds').innerHTML = '<h3 class="hint" style="margin-top:14px">Operator credentials (set in DAT settings below)</h3><ul class="checklist">' +
        plan.operator.map(function(o){
          var icon = o.set ? '<span class="ok">✓</span>' : (o.required ? '<span class="bad">✗</span>' : '<span class="skip">○</span>');
          var note = o.set
            ? (o.detail ? ' <span class="hint">— ' + esc(o.detail) + '</span>' : '')
            : (o.required ? ' <span class="hint">— not set</span>' : ' <span class="hint">(optional, not set)</span>');
          return '<li>' + icon + '<span>' + esc(o.key) + '</span>' + note + '</li>';
        }).join('') + '</ul>';
    } else { $('operatorNeeds').innerHTML = ''; }

    if (deploy){
      if (plan.hasEnvExample === false){
        $('appSecrets').innerHTML = '<p class="hint" style="margin-top:14px">No .env.example found — the app may need no extra secrets to boot.</p>';
      } else {
        var rows = (plan.appSecrets || []).map(function(s){
          if (s.kind === 'required'){
            return '<label>' + esc(s.key) + '<input type="password" data-appkey="' + esc(s.key) + '" value="' + esc(s.defaultValue || '') + '" placeholder="required for boot" autocomplete="off"></label>';
          }
          var badge = s.kind === 'auto-db' ? 'auto-provisioned' : (s.kind === 'auto-auth' ? 'auto-generated' : 'default');
          return '<label>' + esc(s.key) + ' <span class="setpill">' + badge + '</span><div class="hint">' + esc(s.note) + '</div></label>';
        }).join('');
        $('appSecrets').innerHTML = '<h3 class="hint" style="margin-top:14px">This app\\'s .env <span>(in memory for this run only — never written)</span></h3><div class="settings-grid">' + rows + '</div>';
      }
    } else { $('appSecrets').innerHTML = ''; }
  }

  // ---- run a scan with live progress (SSE) ----
  $('runBtn').addEventListener('click', runScan);

  function runScan(){
    if (!state.path) return;
    var body = { path: state.path };
    if ($('profile').value) body.profile = $('profile').value;
    var dast = $('dast').value;
    if (dast === 'url' && $('url').value.trim()) body.url = $('url').value.trim();
    if (dast === 'deploy') {
      if (!window.confirm('This provisions an ephemeral GCP Cloud Run + Neon database, scans it, then tears them down. Continue?')) return;
      body.deploy = true;
      var secs = {};
      var inputs = document.querySelectorAll('#appSecrets input[data-appkey]');
      for (var i = 0; i < inputs.length; i++) { if (inputs[i].value) secs[inputs[i].getAttribute('data-appkey')] = inputs[i].value; }
      body.appSecrets = secs;
    }

    $('runBtn').disabled = true;
    $('progress').classList.remove('hidden');
    $('scanners').innerHTML = '';
    $('logtail').textContent = '';
    $('result').className = 'hidden';
    $('result').innerHTML = '';
    $('runStatus').textContent = 'Starting…';

    api('/api/scan', { method:'POST', body: JSON.stringify(body) })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (!res.ok) { $('runStatus').textContent = res.j.error || 'Could not start scan.'; $('runBtn').disabled = false; return; }
        openStream(res.j.runId);
      })
      .catch(function(){ $('runStatus').textContent = 'Network error.'; $('runBtn').disabled = false; });
  }

  function openStream(runId){
    var es = new EventSource('/api/scan/' + encodeURIComponent(runId) + '/stream?t=' + encodeURIComponent(TOKEN));
    var scanners = {};
    es.onmessage = function(msg){
      var e; try { e = JSON.parse(msg.data); } catch(_){ return; }
      if (e.type === 'log') { appendLog(e.line); }
      else if (e.type === 'scanner') { scanners[e.name] = e.state; renderScanners(scanners); $('runStatus').textContent = (e.state==='skipped'?'Skipped ':'Running ') + e.name + '…'; }
      else if (e.type === 'end') { es.close(); finishRun(e); }
    };
    es.onerror = function(){ es.close(); if ($('runBtn').disabled) { $('runStatus').textContent = 'Connection lost.'; $('runBtn').disabled = false; } };
  }

  function appendLog(line){
    var el = $('logtail');
    var lines = (el.textContent ? el.textContent.split('\\n') : []);
    lines.push(line);
    if (lines.length > 200) lines = lines.slice(-200);
    el.textContent = lines.join('\\n');
    el.scrollTop = el.scrollHeight;
  }

  function renderScanners(map){
    $('scanners').innerHTML = Object.keys(map).map(function(name){
      var st = map[name];
      var icon = st === 'skipped' ? '<span class="skip">⤼</span>' : '<span class="spin">➜</span>';
      var tag = st === 'skipped' ? ' <span class="hint">(skipped — tool not installed)</span>' : '';
      return '<li>' + icon + '<span>' + esc(name) + '</span>' + tag + '</li>';
    }).join('');
  }

  function finishRun(e){
    $('runBtn').disabled = false;
    var r = e.result || {};
    $('runStatus').textContent = 'Done.';
    var pass = r.gate === 'pass';
    var banner = $('result');
    banner.className = 'result ' + (pass ? 'pass' : 'fail');
    var link = r.reportFile ? ' · <a href="/r/' + esc(r.reportFile) + '" target="_blank">Open full report →</a>' : '';
    var verdict = r.gate ? (pass ? '✅ Quality Gate Passed' : '❌ Quality Gate Failed') : '⚠️ Scan ended (exit ' + e.exitCode + ')';
    banner.innerHTML = verdict + ' · Score ' + (r.score != null ? r.score : '?') + '/100' + link;
    loadReports();
  }

  // ---- operator settings ----
  function loadSettings(){
    api('/api/operator-settings').then(function(r){ return r.json(); }).then(function(d){
      $('settings').innerHTML = (d.settings||[]).map(function(s){
        return '<label>' + esc(s.key) + (s.set ? '<span class="setpill">set ✓</span>' : '') +
          '<input type="password" data-key="' + esc(s.key) + '" placeholder="' + (s.set ? '•••••• (unchanged)' : '(not set)') + '" autocomplete="off"></label>';
      }).join('');
    }).catch(function(){});
  }
  $('saveSettings').addEventListener('click', function(){
    var body = {};
    var inputs = document.querySelectorAll('#settings input[data-key]');
    for (var i=0;i<inputs.length;i++){ var v = inputs[i].value; if (v !== '') body[inputs[i].getAttribute('data-key')] = v; }
    if (Object.keys(body).length === 0) { $('settingsMsg').textContent = 'Nothing to save.'; return; }
    api('/api/operator-settings', { method:'POST', body: JSON.stringify(body) })
      .then(function(r){ return r.json(); })
      .then(function(){ $('settingsMsg').textContent = 'Saved.'; loadSettings(); })
      .catch(function(){ $('settingsMsg').textContent = 'Save failed.'; });
  });

  // ---- reports list ----
  function loadReports(){
    api('/api/reports').then(function(r){ return r.json(); }).then(function(list){
      if (!list || !list.length) { return; }
      var rows = list.map(function(e){
        var badge = e.gate==='pass' ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>';
        return '<tr><td><a href="/r/'+esc(e.file)+'" target="_blank">'+esc(e.appName)+'</a></td><td>'+esc(e.timestamp)+'</td><td>'+badge+'</td><td>'+esc(e.score)+'/100</td></tr>';
      }).join('');
      $('reports').innerHTML = '<table class="reports"><thead><tr><th>App</th><th>When</th><th>Gate</th><th>Score</th></tr></thead><tbody>'+rows+'</tbody></table>';
    }).catch(function(){});
  }

  loadSettings();
  loadReports();
})();
</script>
</body>
</html>`;
}

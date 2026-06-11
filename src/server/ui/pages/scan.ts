import { inlineJson, PageFragment } from '../render.js';
import { SCANNER_DESCRIPTIONS } from '../../moduleCatalog.js';

// The scan workflow page: target → options → readiness → DAST setup → run with live SSE
// progress. Moved from the original single-page layout; element ids are unchanged.
//
// ESCAPING RULE: no backticks / ${ in the client JS (string concat + var only).
export function scanPage(): PageFragment {
  const html = `
  <h1>New Scan</h1>
  <p class="lede">Point DAT at an app, see what the scan needs, then run it with live progress.</p>

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
    <div id="deployOpts"></div>
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
  </div>`;

  const js = `
  // ---- scan page state ----
  var scanState = { path: null };
  var scanners = {};
  var findingsByScanner = {};
  var SCANNER_DESC = ${inlineJson(SCANNER_DESCRIPTIONS)};

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
        scanState.path = res.j.path;
        setPrefs({ lastPath: res.j.path });
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
    if (!scanState.path) return;
    var q = new URLSearchParams();
    q.set('path', scanState.path);
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
    if (dast === 'none' || !scanState.path) { $('dastPanel').classList.add('hidden'); return; }
    var q = new URLSearchParams(); q.set('path', scanState.path);
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
      $('operatorNeeds').innerHTML = '<h3 class="hint" style="margin-top:14px">Operator credentials (set in Settings)</h3><ul class="checklist">' +
        plan.operator.map(function(o){
          var icon = o.set ? '<span class="ok">✓</span>' : (o.required ? '<span class="bad">✗</span>' : '<span class="skip">○</span>');
          var note = o.set
            ? (o.detail ? ' <span class="hint">— ' + esc(o.detail) + '</span>' : '')
            : (o.required ? ' <span class="hint">— not set</span>' : ' <span class="hint">(optional, not set)</span>');
          return '<li>' + icon + '<span>' + esc(o.key) + '</span>' + note + '</li>';
        }).join('') + '</ul>';
    } else { $('operatorNeeds').innerHTML = ''; }

    if (deploy){
      $('deployOpts').innerHTML = '<label style="display:flex;gap:8px;align-items:flex-start;margin-top:14px;font-size:.85rem">' +
        '<input type="checkbox" id="allowUnauth" style="margin-top:3px">' +
        '<span>Deploy the preview <b>public</b> (no IAM token) so the scanner can reach it — needed when you don\\'t have a service account (e.g. a personal gcloud login). The throwaway service is torn down after the scan.</span></label>';
    } else { $('deployOpts').innerHTML = ''; }

    if (deploy){
      if (plan.hasEnvExample === false){
        $('appSecrets').innerHTML = '<p class="hint" style="margin-top:14px">No .env.example found — the app may need no extra secrets to boot.</p>';
      } else {
        var rows = (plan.appSecrets || []).map(function(s){
          if (s.kind === 'required'){
            // Mask only genuinely secret-looking keys; show plain text for things like *_EMAIL/_URL
            // so a prefilled default (e.g. admin@bakery.test) is readable, not dots.
            var isSecret = /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE|API[_-]?KEY|_KEY$|^KEY$|ACCESS[_-]?KEY)/i.test(s.key);
            return '<label>' + esc(s.key) + '<input type="' + (isSecret ? 'password' : 'text') + '" data-appkey="' + esc(s.key) + '" value="' + esc(s.defaultValue || '') + '" placeholder="required for boot" autocomplete="off"></label>';
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

  function setScanRunning(on){
    App.scanRunning = on;
    $('navScanDot').classList.toggle('hidden', !on);
  }

  function runScan(){
    if (!scanState.path) return;
    var body = { path: scanState.path };
    if ($('profile').value) body.profile = $('profile').value;
    var dast = $('dast').value;
    if (dast === 'url' && $('url').value.trim()) body.url = $('url').value.trim();
    if (dast === 'deploy') {
      if (!window.confirm('This provisions an ephemeral GCP Cloud Run + Neon database, scans it, then tears them down. Continue?')) return;
      body.deploy = true;
      var unauth = document.getElementById('allowUnauth');
      if (unauth && unauth.checked) body.allowUnauthenticated = true;
      var secs = {};
      var inputs = document.querySelectorAll('#appSecrets input[data-appkey]');
      for (var i = 0; i < inputs.length; i++) { if (inputs[i].value) secs[inputs[i].getAttribute('data-appkey')] = inputs[i].value; }
      body.appSecrets = secs;
    }

    $('runBtn').disabled = true;
    $('progress').classList.remove('hidden');
    scanners = {}; findingsByScanner = {};
    $('scanners').innerHTML = '';
    $('logtail').textContent = '';
    $('result').className = 'hidden';
    $('result').innerHTML = '';
    $('runStatus').textContent = 'Starting…';
    setScanRunning(true);

    api('/api/scan', { method:'POST', body: JSON.stringify(body) })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (!res.ok) { $('runStatus').textContent = res.j.error || 'Could not start scan.'; $('runBtn').disabled = false; setScanRunning(false); return; }
        openStream(res.j.runId);
      })
      .catch(function(){ $('runStatus').textContent = 'Network error.'; $('runBtn').disabled = false; setScanRunning(false); });
  }

  function openStream(runId){
    var es = new EventSource('/api/scan/' + encodeURIComponent(runId) + '/stream?t=' + encodeURIComponent(TOKEN));
    es.onmessage = function(msg){
      var e; try { e = JSON.parse(msg.data); } catch(_){ return; }
      if (e.type === 'log') { appendLog(e.line); }
      else if (e.type === 'scanner') { scanners[e.name] = { state: e.state, reason: e.reason }; renderScanners(); $('runStatus').textContent = (e.state==='skipped'?'Skipped ':'Running ') + e.name + '…'; }
      else if (e.type === 'end') { es.close(); finishRun(e); }
    };
    es.onerror = function(){ es.close(); if ($('runBtn').disabled) { $('runStatus').textContent = 'Connection lost.'; $('runBtn').disabled = false; setScanRunning(false); } };
  }

  function appendLog(line){
    var el = $('logtail');
    var lines = (el.textContent ? el.textContent.split('\\n') : []);
    lines.push(line);
    if (lines.length > 200) lines = lines.slice(-200);
    el.textContent = lines.join('\\n');
    el.scrollTop = el.scrollHeight;
  }

  function renderScanners(){
    $('scanners').innerHTML = Object.keys(scanners).map(function(name){
      var entry = scanners[name];
      var st = entry.state;
      var icon = st === 'skipped' ? '<span class="skip">⤼</span>' : (st === 'done' ? '<span class="ok">✓</span>' : '<span class="spin">➜</span>');
      var meta = '';
      if (st === 'skipped') {
        meta = '<span class="scanner-meta hint">(skipped — ' + esc(entry.reason || 'tool not installed') + ')</span>';
      } else {
        var res = findingsByScanner[name];
        if (res) {
          var n = (res.issues || []).length;
          meta = n > 0
            ? '<span class="scanner-meta"><button class="view-btn" data-view-scanner="' + esc(name) + '">View findings (' + n + ')</button></span>'
            : '<span class="scanner-meta hint">✓ no findings</span>';
        }
      }
      var desc = SCANNER_DESC[name];
      return '<li><div class="scanner-row">' + icon + '<span>' + esc(name) + '</span>' + meta + '</div>' +
        (desc ? '<div class="scanner-desc">' + esc(desc) + '</div>' : '') + '</li>';
    }).join('');
  }

  // Per-scanner "View findings" on the live run list (delegated — rows are re-rendered).
  $('scanners').addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-view-scanner]');
    if (!btn) return;
    var name = btn.getAttribute('data-view-scanner');
    var res = findingsByScanner[name];
    openFindingsModal(name + ' — findings', res ? [res] : []);
  });

  function finishRun(e){
    $('runBtn').disabled = false;
    setScanRunning(false);
    var r = e.result || {};
    $('runStatus').textContent = 'Done.';
    var pass = r.gate === 'pass';
    var banner = $('result');
    banner.className = 'result ' + (pass ? 'pass' : 'fail');
    var link = r.reportFile
      ? ' · <a href="#/reports/' + esc(r.reportFile) + '">View report →</a> · <a href="/r/' + esc(r.reportFile) + '" target="_blank">full HTML</a>'
      : '';
    var verdict = r.gate ? (pass ? '✅ Quality Gate Passed' : '❌ Quality Gate Failed') : '⚠️ Scan ended (exit ' + e.exitCode + ')';
    banner.innerHTML = verdict + ' · Score ' + (r.score != null ? r.score : '?') + '/100' + link;

    // Mark still-running scanners as done, then load the published findings so each row gets a
    // "View findings" button. The sidecar is authoritative, so reconcile any scanner it lists.
    Object.keys(scanners).forEach(function(n){ if (scanners[n].state === 'running') scanners[n].state = 'done'; });
    if (r.reportFile) {
      fetchFindings(r.reportFile).then(function(results){
        findingsByScanner = {};
        (results || []).forEach(function(res){
          findingsByScanner[res.scannerName] = res;
          if (!scanners[res.scannerName]) scanners[res.scannerName] = { state: res.skipped ? 'skipped' : 'done', reason: res.skipReason };
        });
        renderScanners();
      });
    } else { renderScanners(); }
    App.reportsDirty = true;
  }

  App.pages['scan'] = { onShow: function(){
    if (!$('path').value) {
      var p = getPrefs();
      if (p.lastPath) $('path').value = p.lastPath;
      if (p.defaultProfile) $('profile').value = p.defaultProfile;
    }
  } };`;

  return { id: 'scan', html, js };
}

import { escapeHtml, PageFragment } from '../render.js';
import { OPERATOR_KEY_DOCS, OPERATOR_GROUPS } from '../../moduleCatalog.js';
import { OPERATOR_ENV_KEYS } from '../../operatorEnv.js';

// Settings page: operator credentials grouped by what they unlock (stored once in ~/.dat/.env,
// chmod 600, injected into scans), plus local UI preferences (this machine only).
//
// ESCAPING RULE: no backticks / ${ in the client JS (string concat + var only).
export function settingsPage(): PageFragment {
  const groupsHtml = OPERATOR_GROUPS.map((g) => {
    const keys = OPERATOR_ENV_KEYS.filter((k) => OPERATOR_KEY_DOCS[k]?.group === g.id);
    if (keys.length === 0) return '';
    const rows = keys.map((k) => {
      const doc = OPERATOR_KEY_DOCS[k];
      return `
      <div class="keyrow">
        <div>
          <span class="kname">${escapeHtml(k)}</span><span class="setpill hidden" data-set-for="${escapeHtml(k)}">set ✓</span>
          <div class="kdoc">${escapeHtml(doc.purpose)} <em>Unlocks: ${escapeHtml(doc.unlocks)}</em></div>
        </div>
        <div><input type="password" data-key="${escapeHtml(k)}" placeholder="(not set)" autocomplete="off"></div>
      </div>`;
    }).join('');
    return `<div class="keygroup"><h3>${escapeHtml(g.label)}</h3>${rows}</div>`;
  }).join('');

  const html = `
  <h1>Settings</h1>
  <p class="lede">Operator credentials are stored once in <code>~/.dat/.env</code> (owner-only, chmod 600)
    and injected into every scan. None are needed for static scans — only for ephemeral deploys,
    LLM features, and integration pushes.</p>

  <div class="card">
    <h2>Operator credentials</h2>
    <div id="settingsRoot">${groupsHtml}</div>
    <div class="btnrow">
      <button class="secondary" id="saveSettings">Save settings</button>
      <span id="settingsMsg" class="hint"></span>
    </div>
  </div>

  <div class="card">
    <h2>Preferences <span class="hint">— this browser only</span></h2>
    <div class="row">
      <div>
        <label>Default scan profile</label>
        <select id="prefProfile">
          <option value="">(config default)</option>
          <option value="quick">quick</option>
          <option value="standard">standard</option>
          <option value="security">security</option>
          <option value="full">full</option>
        </select>
      </div>
      <div>
        <label>Last scanned path <span class="hint">(prefilled on New Scan)</span></label>
        <div class="btnrow" style="margin-top:0">
          <code id="prefLastPath" class="hint" style="font-size:.8rem; word-break:break-all">—</code>
          <button class="secondary" id="prefClearPath" style="padding:6px 12px;font-size:.78rem">Clear</button>
        </div>
      </div>
    </div>
  </div>`;

  const js = `
  // ---- settings ----
  function loadSettings(){
    api('/api/operator-settings').then(function(r){ return r.json(); }).then(function(d){
      (d.settings || []).forEach(function(s){
        var pill = document.querySelector('[data-set-for="' + s.key + '"]');
        if (pill) pill.classList.toggle('hidden', !s.set);
        var input = document.querySelector('#settingsRoot input[data-key="' + s.key + '"]');
        if (input) input.placeholder = s.set ? '•••••• (unchanged)' : '(not set)';
      });
    }).catch(function(){});
  }
  $('saveSettings').addEventListener('click', function(){
    var body = {};
    var inputs = document.querySelectorAll('#settingsRoot input[data-key]');
    for (var i = 0; i < inputs.length; i++){ var v = inputs[i].value; if (v !== '') body[inputs[i].getAttribute('data-key')] = v; }
    if (Object.keys(body).length === 0) { $('settingsMsg').textContent = 'Nothing to save.'; return; }
    api('/api/operator-settings', { method:'POST', body: JSON.stringify(body) })
      .then(function(r){ return r.json(); })
      .then(function(){
        $('settingsMsg').textContent = 'Saved.';
        for (var i = 0; i < inputs.length; i++) inputs[i].value = '';
        loadSettings();
      })
      .catch(function(){ $('settingsMsg').textContent = 'Save failed.'; });
  });

  function refreshPrefsUi(){
    var p = getPrefs();
    $('prefProfile').value = p.defaultProfile || '';
    $('prefLastPath').textContent = p.lastPath || '—';
  }
  $('prefProfile').addEventListener('change', function(){ setPrefs({ defaultProfile: this.value }); });
  $('prefClearPath').addEventListener('click', function(){ setPrefs({ lastPath: '' }); refreshPrefsUi(); });

  App.pages['settings'] = { onShow: function(){ loadSettings(); refreshPrefsUi(); } };`;

  return { id: 'settings', html, js };
}

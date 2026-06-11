import { PageFragment } from '../render.js';

// Testing Modules page: documents every scanner — what it does, what it requires (binaries with
// live installed-status, inputs, API keys), its configurable options, profile membership, and a
// copyable .dat.config.yaml snippet. Read-only: DAT never writes the target repo's config.
//
// ESCAPING RULE: no backticks / ${ in the client JS (string concat + var only).
export function modulesPage(): PageFragment {
  const html = `
  <h1>Testing Modules</h1>
  <p class="lede">Every check DAT can run, what each needs to work, and how to configure it.
    Configuration is read-only here — copy a snippet into the app's <code>.dat.config.yaml</code> yourself.</p>
  <div class="toolbar">
    <button class="secondary" id="modulesRefresh">Re-check installed tools</button>
    <span class="hint" id="modulesStatus"></span>
  </div>
  <div id="modulesRoot"><p class="hint">Loading…</p></div>`;

  const js = `
  // ---- testing modules ----
  function loadModules(force){
    if (!force && App.modulesCache) { renderModules(App.modulesCache); return; }
    $('modulesStatus').textContent = 'Probing tools…';
    api('/api/modules').then(function(r){ return r.json(); }).then(function(d){
      App.modulesCache = d;
      $('modulesStatus').textContent = '';
      renderModules(d);
    }).catch(function(){ $('modulesStatus').textContent = 'Could not load modules.'; });
  }

  function langChips(langs){
    if (langs === 'all') return '<span class="langchip">all languages</span>';
    return langs.map(function(l){ return '<span class="langchip">' + esc(l) + '</span>'; }).join('');
  }

  function profChips(profiles){
    return ['quick', 'standard', 'security', 'full'].map(function(p){
      return '<span class="profchip' + (profiles.indexOf(p) >= 0 ? ' on' : '') + '">' + p + '</span>';
    }).join('');
  }

  function renderModule(m){
    var bins = m.binaries.length ? m.binaries.map(function(b){
      return b.installed
        ? '<span class="ok">✓</span> <code>' + esc(b.name) + '</code>'
        : '<span class="bad">✗</span> <code>' + esc(b.name) + '</code>' + (b.hint ? ' <span class="hint">— ' + esc(b.hint) + '</span>' : '');
    }).join('<br>') : '<span class="hint">none — built into DAT</span>';

    var inputs = m.inputs.length ? m.inputs.map(function(i){
      return esc(i.label) + '<span class="pill ' + esc(i.tier) + '">' + esc(i.tier) + '</span>';
    }).join('<br>') : '<span class="hint">none — the source code is enough</span>';

    var keys = m.envKeys.length ? m.envKeys.map(function(k){
      return (k.set ? '<span class="ok">✓</span> ' : '<span class="hint">—</span> ') + '<code>' + esc(k.key) + '</code>' +
        (k.purpose ? ' <span class="hint">' + esc(k.purpose) + '</span>' : '');
    }).join('<br>') : '';

    var opts = m.options.length
      ? '<table class="opts"><thead><tr><th>Option</th><th>Default</th><th>What it does</th></tr></thead><tbody>' +
        m.options.map(function(o){
          var def = o.default === undefined ? '—' : (Array.isArray(o.default) ? o.default.join(', ') : String(o.default));
          return '<tr><td><code>' + esc(o.name) + '</code></td><td>' + esc(def) + '</td><td>' + esc(o.description) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '';

    return '<div class="module-card">' +
      '<h3>' + esc(m.name) + ' ' + profChips(m.profiles) + '</h3>' +
      '<p class="mdesc">' + esc(m.description) + (m.note ? ' <em>' + esc(m.note) + '</em>' : '') + '</p>' +
      '<div class="mrow"><span class="mlab">Languages</span><span>' + langChips(m.supportedLanguages) + '</span></div>' +
      '<div class="mrow"><span class="mlab">Tools</span><span>' + bins + '</span></div>' +
      '<div class="mrow"><span class="mlab">App inputs</span><span>' + inputs + '</span></div>' +
      (keys ? '<div class="mrow"><span class="mlab">API keys</span><span>' + keys + '</span></div>' : '') +
      opts +
      '<details class="snip"><summary>Config snippet (.dat.config.yaml)</summary>' +
      '<pre class="cmd" id="snip-' + esc(m.key) + '">' + esc(m.configSnippet) + '</pre>' +
      '<button class="secondary" data-copy-snip="snip-' + esc(m.key) + '" style="margin-top:6px;padding:6px 12px;font-size:.78rem">Copy snippet</button>' +
      '</details>' +
      '</div>';
  }

  function renderModules(d){
    $('modulesRoot').innerHTML = d.groups.map(function(g){
      var mods = d.modules.filter(function(m){ return m.module === g.id; });
      if (!mods.length) return '';
      return '<div class="mgroup-title">' + esc(g.label) + ' (' + mods.length + ')</div>' + mods.map(renderModule).join('');
    }).join('');
  }

  $('modulesRoot').addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-copy-snip]');
    if (!btn) return;
    var pre = $(btn.getAttribute('data-copy-snip'));
    if (pre && navigator.clipboard) {
      navigator.clipboard.writeText(pre.textContent);
      btn.textContent = 'Copied!';
      setTimeout(function(){ btn.textContent = 'Copy snippet'; }, 1200);
    }
  });
  $('modulesRefresh').addEventListener('click', function(){ loadModules(true); });

  App.pages['modules'] = { onShow: function(){ loadModules(); } };`;

  return { id: 'modules', html, js };
}

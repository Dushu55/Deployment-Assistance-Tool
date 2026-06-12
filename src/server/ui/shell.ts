// The document shell: sidebar nav + content area + the global findings modal.
// The brand text "DAT Control Panel" is asserted by ui.test.ts — keep it literal.
export function renderShell(pagesHtml: string): string {
  return `
<nav class="sidebar">
  <div class="brand">🛡️ DAT Control Panel<small>Deployment Assist Tool — local</small></div>
  <a href="#/reports" data-nav="reports">📊 Reports</a>
  <a href="#/scan" data-nav="scan">▶ New Scan <span id="navScanDot" class="scan-dot hidden"></span></a>
  <a href="#/modules" data-nav="modules">🧪 Testing Modules</a>
  <a href="#/settings" data-nav="settings">⚙️ Settings</a>
  <a href="#/help" data-nav="help">❓ Help</a>
  <div class="navfoot">Loopback only · token-gated<br>Reports live in ~/.dat/reports</div>
</nav>
<main class="content">
${pagesHtml}
</main>

<div id="findingsModal" class="modal-backdrop hidden">
  <div class="modal">
    <div class="modal-head"><h2 id="modalTitle">Findings</h2><button class="modal-close" id="modalClose">Close</button></div>
    <div class="modal-body" id="modalBody"></div>
  </div>
</div>`;
}

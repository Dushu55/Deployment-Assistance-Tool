// The DAT control panel SPA — a single self-contained HTML document (no build step, no external
// assets, so it works offline and under a strict environment). Served by src/server/ui.ts at `/`.
// The session token arrives via `?t=...` (printed in the terminal), is stashed in sessionStorage,
// stripped from the URL (hash preserved), and sent as `X-DAT-Token` on every /api call.
//
// Structure: a sidebar shell with hash-routed pages (#/reports, #/scan, #/modules, #/settings,
// #/help). Each page lives in src/server/ui/pages/* as a { html, js } fragment; this file just
// assembles them. All page sections render up-front and are toggled by the router, so live state
// (e.g. an SSE scan stream) survives navigation.
//
// ESCAPING RULE for every fragment: the assembled document is one TS template literal, so client
// JS contains NO backticks and NO ${ — string concat + var only; server data is injected via
// inlineJson() (see src/server/ui/render.ts).
import { BASE_CSS } from './ui/styles.js';
import { renderShell } from './ui/shell.js';
import { CORE_JS } from './ui/clientCore.js';
import { reportsPage } from './ui/pages/reports.js';
import { reportDetailPage } from './ui/pages/reportDetail.js';
import { scanPage } from './ui/pages/scan.js';
import { modulesPage } from './ui/pages/modules.js';
import { settingsPage } from './ui/pages/settings.js';
import { helpPage } from './ui/pages/help.js';

export function renderUiHtml(): string {
  const pages = [reportsPage(), reportDetailPage(), scanPage(), modulesPage(), settingsPage(), helpPage()];
  const sections = pages
    .map((p) => `<section class="page hidden" id="page-${p.id}">${p.html}</section>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DAT Control Panel</title>
<style>${BASE_CSS}</style>
</head>
<body>
${renderShell(sections)}
<script>
(function(){
${CORE_JS}
${pages.map((p) => p.js).join('\n')}
App.start();
})();
</script>
</body>
</html>`;
}

// All CSS for the control panel, sectioned by comment banners. No backticks/${ inside.
export const BASE_CSS = `
  :root {
    --bg:#f6f7f9; --card:#fff; --ink:#1f2933; --muted:#6b7785; --line:#e4e8ee;
    --brand:#2C3E50; --accent:#1a73e8; --green:#137333; --amber:#b8860b; --red:#c5221f;
    --sidebar:#1f2933;
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--ink); display:flex; min-height:100vh; }

  /* ---- sidebar shell ---- */
  nav.sidebar { width:212px; flex:0 0 212px; background:var(--sidebar); color:#e2e8f0; display:flex; flex-direction:column; position:sticky; top:0; height:100vh; }
  .brand { padding:20px 18px 14px; font-weight:700; font-size:.98rem; color:#fff; border-bottom:1px solid rgba(255,255,255,.08); }
  .brand small { display:block; font-weight:400; font-size:.7rem; color:#94a3b8; margin-top:3px; }
  nav.sidebar a { display:flex; align-items:center; gap:10px; padding:11px 18px; color:#cbd5e1; text-decoration:none; font-size:.88rem; border-left:3px solid transparent; }
  nav.sidebar a:hover { background:rgba(255,255,255,.06); text-decoration:none; color:#fff; }
  nav.sidebar a.active { background:rgba(255,255,255,.1); color:#fff; border-left-color:var(--accent); font-weight:600; }
  .navfoot { margin-top:auto; padding:14px 18px; font-size:.68rem; color:#94a3b8; border-top:1px solid rgba(255,255,255,.08); }
  .scan-dot { width:8px; height:8px; border-radius:50%; background:#fbbf24; display:inline-block; animation:pulse 1.2s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
  main.content { flex:1; min-width:0; padding:24px 28px; max-width:1080px; }
  .page.hidden { display:none; }
  .page h1 { font-size:1.2rem; margin:0 0 4px; }
  .page p.lede { margin:0 0 18px; font-size:.86rem; color:var(--muted); }
  @media (max-width:760px){
    body { flex-direction:column; }
    nav.sidebar { width:100%; flex:none; height:auto; position:static; flex-direction:row; flex-wrap:wrap; align-items:center; }
    .brand { border-bottom:0; padding:12px 14px; } .brand small { display:none; }
    nav.sidebar a { padding:10px 12px; border-left:0; }
    .navfoot { display:none; }
    main.content { padding:16px; }
  }

  /* ---- shared primitives (cards, forms, badges) ---- */
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:18px; }
  .card h2 { margin:0 0 12px; font-size:1rem; }
  label { display:block; font-size:.8rem; color:var(--muted); margin-bottom:4px; }
  input[type=text], input[type=password], select { width:100%; padding:9px 11px; border:1px solid var(--line); border-radius:8px; font-size:.92rem; background:#fff; color:var(--ink); }
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

  /* ---- scan progress ---- */
  ul.scanners { list-style:none; margin:12px 0 0; padding:0; }
  ul.scanners li { padding:7px 0; font-size:.88rem; border-bottom:1px solid var(--line); }
  ul.scanners li:last-child { border-bottom:0; }
  .scanner-row { display:flex; gap:8px; align-items:center; }
  .scanner-desc { margin-left:24px; margin-top:2px; font-size:.76rem; color:var(--muted); }
  .scanner-meta { margin-left:auto; display:flex; align-items:center; gap:6px; }
  .spin { color:var(--accent); } .skip { color:var(--muted); }
  pre.logtail { background:#0f172a; color:#cbd5e1; padding:12px; border-radius:8px; font-size:.76rem; max-height:200px; overflow:auto; margin-top:12px; white-space:pre-wrap; }
  .result { margin-top:14px; padding:12px 14px; border-radius:8px; font-weight:600; font-size:.95rem; }
  .result.pass { background:#e6f4ea; color:var(--green); }
  .result.fail { background:#fdecea; color:var(--red); }
  .view-btn { background:#eef1f5; color:var(--accent); border:0; border-radius:6px; padding:3px 10px; font-size:.74rem; font-weight:600; cursor:pointer; margin-left:8px; }
  .view-btn:hover { filter:brightness(.96); }

  /* ---- settings ---- */
  .settings-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; margin:10px 0; }
  @media (max-width:760px){ .settings-grid { grid-template-columns:1fr; } }
  .settings-grid label { font-size:.78rem; }
  .settings-grid input { padding:7px 9px; }
  .setpill { font-size:.66rem; color:var(--green); margin-left:6px; }
  .keygroup { margin-bottom:18px; }
  .keygroup h3 { font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 8px; }
  .keyrow { display:grid; grid-template-columns:minmax(220px,1fr) 2fr; gap:4px 16px; padding:10px 0; border-bottom:1px solid var(--line); align-items:start; }
  .keyrow:last-child { border-bottom:0; }
  .keyrow .kname { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.8rem; }
  .keyrow .kdoc { font-size:.76rem; color:var(--muted); grid-column:1 / -1; }
  @media (max-width:760px){ .keyrow { grid-template-columns:1fr; } }

  /* ---- findings modal + finding cards ---- */
  .modal-backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; z-index:50; overflow:auto; }
  .modal-backdrop.hidden { display:none; }
  .modal { background:var(--card); border-radius:12px; max-width:760px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 12px 40px rgba(0,0,0,.25); }
  .modal-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 20px; border-bottom:1px solid var(--line); }
  .modal-head h2 { margin:0; font-size:1rem; }
  .modal-close { background:#eef1f5; color:var(--ink); padding:6px 12px; }
  .modal-body { padding:16px 20px; overflow:auto; }
  .fg-scanner { font-size:.9rem; margin:20px 0 10px; border-bottom:1px solid var(--line); padding-bottom:4px; }
  .fg-scanner:first-child { margin-top:0; }
  .finding { border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:10px; }
  .f-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .f-id { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.76rem; color:var(--muted); }
  .f-src { font-size:.72rem; color:var(--muted); margin-left:auto; }
  .f-msg { margin-top:6px; font-size:.86rem; white-space:pre-wrap; }
  .f-loc { margin-top:6px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.75rem; background:#f1f3f5; padding:2px 6px; border-radius:4px; display:inline-block; }
  .f-rem { margin-top:6px; font-size:.82rem; }
  .badge.sev-CRITICAL, .badge.sev-HIGH { background:#fdecea; color:var(--red); }
  .badge.sev-MEDIUM { background:#fff4e0; color:var(--amber); }
  .badge.sev-LOW { background:#eef1f5; color:var(--muted); }
  .badge.sev-INFO { background:#e8f0fe; color:var(--accent); }

  /* ---- reports overview ---- */
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:18px; }
  .kpi { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .kpi .kv { font-size:1.45rem; font-weight:700; }
  .kpi .kl { font-size:.72rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-top:2px; }
  .chip { display:inline-block; padding:3px 10px; border-radius:999px; font-size:.74rem; font-weight:700; }
  .chip.green { background:#e6f4ea; color:var(--green); }
  .chip.yellow { background:#fff4e0; color:var(--amber); }
  .chip.red { background:#fdecea; color:var(--red); }
  .delta-up { color:var(--green); font-weight:600; font-size:.8rem; }
  .delta-down { color:var(--red); font-weight:600; font-size:.8rem; }
  .delta-flat { color:var(--muted); font-size:.8rem; }
  svg.spark { vertical-align:middle; }
  svg.spark.green { color:var(--green); } svg.spark.yellow { color:var(--amber); } svg.spark.red { color:var(--red); }
  .approw { display:flex; align-items:center; gap:14px; padding:12px 0; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .approw:last-child { border-bottom:0; }
  .approw .appname { font-weight:600; min-width:160px; }
  .approw .stat { font-size:.8rem; color:var(--muted); }
  .toolbar { display:flex; gap:10px; align-items:center; margin-bottom:14px; flex-wrap:wrap; }
  .toolbar input[type=text] { max-width:260px; }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .seg button { background:#fff; color:var(--muted); border:0; border-radius:0; padding:7px 14px; font-size:.8rem; }
  .seg button.on { background:var(--accent); color:#fff; }

  /* ---- report detail ---- */
  .exec { display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .exec .scorebig { font-size:2rem; font-weight:800; }
  .sev-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(96px,1fr)); gap:10px; margin:14px 0; }
  .sev-kpi { border:1px solid var(--line); border-radius:10px; padding:10px 12px; text-align:center; }
  .sev-kpi .n { font-size:1.3rem; font-weight:700; }
  .sev-kpi .l { font-size:.68rem; text-transform:uppercase; color:var(--muted); letter-spacing:.04em; }
  .backlink { font-size:.82rem; }

  /* ---- modules page ---- */
  .module-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:12px; }
  .module-card h3 { margin:0; font-size:.95rem; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .module-card .mdesc { font-size:.82rem; color:var(--muted); margin:4px 0 10px; }
  .mgroup-title { font-size:.85rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:22px 0 10px; }
  .mrow { display:flex; gap:8px; align-items:baseline; font-size:.82rem; padding:3px 0; flex-wrap:wrap; }
  .mrow .mlab { color:var(--muted); font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; min-width:90px; }
  .langchip { display:inline-block; background:#eef1f5; border-radius:6px; padding:1px 7px; font-size:.72rem; margin-right:4px; }
  .profchip { display:inline-block; border:1px solid var(--line); border-radius:6px; padding:1px 7px; font-size:.7rem; margin-right:4px; color:var(--muted); }
  .profchip.on { background:#e8f0fe; color:var(--accent); border-color:#c6dafc; font-weight:600; }
  table.opts { width:100%; border-collapse:collapse; font-size:.78rem; margin:6px 0; }
  table.opts th, table.opts td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); }
  table.opts th { font-size:.66rem; text-transform:uppercase; color:var(--muted); }
  details.snip { margin-top:8px; }
  details.snip summary { cursor:pointer; font-size:.78rem; color:var(--accent); }
  details.snip pre.cmd { margin-top:8px; font-size:.74rem; }

  /* ---- help page ---- */
  table.gloss { width:100%; border-collapse:collapse; font-size:.84rem; margin:8px 0 4px; }
  table.gloss th, table.gloss td { text-align:left; padding:7px 9px; border-bottom:1px solid var(--line); vertical-align:top; }
  table.gloss th { font-size:.68rem; text-transform:uppercase; color:var(--muted); letter-spacing:.04em; }
  ol.pipeline { font-size:.88rem; padding-left:20px; } ol.pipeline li { margin:6px 0; }
`;

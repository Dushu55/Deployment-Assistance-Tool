/**
 * Server-side rendering helpers for the SPA fragments.
 *
 * ESCAPING RULE (applies to every fragment file): the assembled document is one TS template
 * literal, so client JS must contain NO backticks and NO `${` — string concat + `var` only.
 * Server data reaches client JS exclusively through inlineJson().
 */

/** Escape a string for safe embedding in server-rendered HTML. */
export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Serialize server data for inlining into a <script> block (XSS-safe against </script> breakout). */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** One page of the SPA: a hidden <section> plus the client JS that drives it. */
export interface PageFragment {
  id: string;     // section id suffix: <section id="page-<id>">
  html: string;   // section inner HTML (server-rendered)
  js: string;     // client JS, concatenated into the shared IIFE
}

import fs from 'fs';
import { ComponentNode, ComponentEdge, ExtractionResult, Extractor, nodeId } from '../types.js';
import { findFiles, lineAt, relPath } from '../fileScan.js';

const JSX_EXTS = ['.jsx', '.tsx'];
const JS_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs'];

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["'\\{]([^"'}]*)`, 'i'));
  return m ? m[1].trim() : undefined;
}
function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, 'i').test(attrs);
}

/**
 * Heuristic React/JSX extractor. Captures buttons, inputs, forms, and outbound API calls
 * (fetch/axios) with the fail-safe attributes Phase 3 evaluators care about. JSX is parsed
 * structurally via regex (V1); dynamic/templated values are captured best-effort.
 */
export function extractReactComponents(workspaceRoot: string): ExtractionResult {
  const nodes: ComponentNode[] = [];
  const edges: ComponentEdge[] = [];
  const jsxFiles = findFiles(workspaceRoot, JSX_EXTS);
  // API calls can live in plain .ts/.js too (api clients), so scan a broader set for those.
  const codeFiles = findFiles(workspaceRoot, JS_EXTS);
  let index = 0;

  // --- JSX elements: buttons, inputs, forms ---
  for (const file of jsxFiles) {
    let content: string;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relPath(workspaceRoot, file);

    // <button ...> and <Button ...>
    for (const m of content.matchAll(/<(button|Button)\b([^>]*)>/gis)) {
      const attrs = m[2] || '';
      const line = lineAt(content, m.index!);
      nodes.push({
        id: nodeId('Button', rel, line, index++),
        kind: 'Button',
        label: `button${attr(attrs, 'type') ? ` type=${attr(attrs, 'type')}` : ''}`,
        location: { file: rel, line },
        attributes: {
          hasOnClick: hasAttr(attrs, 'onClick'),
          disabledControlled: hasAttr(attrs, 'disabled'),
          type: attr(attrs, 'type') || 'button',
          isSubmit: (attr(attrs, 'type') || '').toLowerCase() === 'submit'
        }
      });
    }

    // <input ...>
    for (const m of content.matchAll(/<input\b([^>]*)\/?>/gis)) {
      const attrs = m[1] || '';
      const line = lineAt(content, m.index!);
      nodes.push({
        id: nodeId('Input', rel, line, index++),
        kind: 'Input',
        label: `input${attr(attrs, 'name') ? ` name=${attr(attrs, 'name')}` : ''}`,
        location: { file: rel, line },
        attributes: {
          inputType: attr(attrs, 'type') || 'text',
          validation: {
            required: hasAttr(attrs, 'required'),
            pattern: hasAttr(attrs, 'pattern'),
            maxLength: hasAttr(attrs, 'maxLength') || hasAttr(attrs, 'maxlength'),
            min: hasAttr(attrs, 'min'),
            max: hasAttr(attrs, 'max')
          },
          hasOnChange: hasAttr(attrs, 'onChange')
        }
      });
    }

    // <form ...>
    for (const m of content.matchAll(/<form\b([^>]*)>/gis)) {
      const attrs = m[1] || '';
      const line = lineAt(content, m.index!);
      nodes.push({
        id: nodeId('Form', rel, line, index++),
        kind: 'Form',
        label: 'form',
        location: { file: rel, line },
        attributes: {
          hasOnSubmit: hasAttr(attrs, 'onSubmit'),
          hasAction: hasAttr(attrs, 'action')
        }
      });
    }
  }

  // --- Outbound API calls: fetch(...) and axios.<method>(...) ---
  for (const file of codeFiles) {
    let content: string;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relPath(workspaceRoot, file);

    const pushApiCall = (matchIndex: number, url: string, method: string, windowText: string) => {
      const line = lineAt(content, matchIndex);
      // Look behind a little for try{} wrapping, and ahead for options/.catch.
      const before = content.slice(Math.max(0, matchIndex - 400), matchIndex);
      nodes.push({
        id: nodeId('ApiCall', rel, line, index++),
        kind: 'ApiCall',
        label: `${method} ${url || '<dynamic>'}`,
        location: { file: rel, line },
        attributes: {
          method,
          url: url || null,
          hasErrorHandling: /\.catch\s*\(/.test(windowText) || /\btry\s*\{/.test(before),
          hasTimeout: /\bsignal\s*:|AbortController|timeout\s*:/.test(windowText),
          hasAuthHeader: /authorization/i.test(windowText)
        }
      });
    };

    // fetch('url', { ...options })
    for (const m of content.matchAll(/\bfetch\s*\(\s*([`'"])([^`'"]*)\1/g)) {
      const win = content.slice(m.index!, m.index! + 300);
      const method = (win.match(/method\s*:\s*["'`](\w+)["'`]/i)?.[1] || 'GET').toUpperCase();
      pushApiCall(m.index!, m[2], method, win);
    }
    // axios.get('url') / axios.post('url', ...)
    for (const m of content.matchAll(/\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*([`'"])([^`'"]*)\2/gi)) {
      const win = content.slice(m.index!, m.index! + 300);
      pushApiCall(m.index!, m[3], m[1].toUpperCase(), win);
    }
  }

  return {
    nodes,
    edges,
    coverage: {
      extractor: 'react',
      filesScanned: jsxFiles.length,
      nodesFound: nodes.length,
      note: jsxFiles.length === 0
        ? 'No JSX/TSX files found.'
        : 'Heuristic JSX parsing (V1): dynamic element props and templated URLs captured best-effort; AST parsing planned.'
    }
  };
}

export const reactExtractor: Extractor = {
  name: 'react',
  extract: extractReactComponents
};

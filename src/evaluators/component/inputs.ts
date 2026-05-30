import { ComponentGraph } from '../../components/types.js';
import { Issue } from '../../types.js';

const SRC = 'Component Evaluator';

/** Robustness/fail-safe checks on UI inputs, forms, and submit buttons. */
export function evaluateInputs(graph: ComponentGraph): Issue[] {
  const issues: Issue[] = [];

  // Files that contain a <form> with an onSubmit handler — used by the submit-button check.
  const filesWithFormHandler = new Set(
    graph.nodes
      .filter(n => n.kind === 'Form' && (n.attributes as any).hasOnSubmit)
      .map(n => n.location.file)
  );

  for (const n of graph.nodes) {
    const a = n.attributes as any;

    if (n.kind === 'Input') {
      const v = a.validation || {};
      const noValidation = !v.required && !v.pattern && !v.maxLength && !v.min && !v.max;
      if (noValidation) {
        issues.push({
          id: 'COMP-INPUT-NO-VALIDATION',
          severity: 'LOW',
          message: `Input ${n.label} has no validation constraints (required/pattern/maxLength/min/max) — unbounded/unchecked user input.`,
          file: n.location.file,
          line: n.location.line,
          remediation: 'Add client-side validation (required, pattern, maxLength, …) AND validate on the server; never trust raw input.',
          source: SRC,
          category: 'robustness'
        });
      }
      if (a.inputType === 'password' && !v.maxLength) {
        issues.push({
          id: 'COMP-INPUT-PASSWORD-NO-MAXLEN',
          severity: 'LOW',
          message: `Password input ${n.label} has no maxLength — unbounded secret input (DoS via huge payloads, hashing cost).`,
          file: n.location.file,
          line: n.location.line,
          remediation: 'Set a reasonable maxLength on password fields and enforce the same bound server-side.',
          source: SRC,
          category: 'robustness'
        });
      }
    }

    if (n.kind === 'Form' && !a.hasOnSubmit && !a.hasAction) {
      issues.push({
        id: 'COMP-FORM-NO-HANDLER',
        severity: 'LOW',
        message: `Form ${n.label} has neither an onSubmit handler nor an action — submitting it does nothing (or triggers a full page reload).`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'Add an onSubmit handler (and preventDefault) or a server action so the form behaves predictably.',
        source: SRC,
        category: 'fail-safe'
      });
    }

    if (n.kind === 'Button' && a.isSubmit && !filesWithFormHandler.has(n.location.file)) {
      issues.push({
        id: 'COMP-BUTTON-SUBMIT-NO-FORM',
        severity: 'LOW',
        message: `Submit button ${n.label} is not inside a form with an onSubmit handler in the same file — its click may have no effect.`,
        file: n.location.file,
        line: n.location.line,
        remediation: 'Place the submit button inside a <form onSubmit=…> or give it an explicit onClick handler.',
        source: SRC,
        category: 'fail-safe'
      });
    }
  }
  return issues;
}

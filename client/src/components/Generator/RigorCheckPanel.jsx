import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

/**
 * Rigor Check panel — runs a Haiku critic against the current draft and
 * surfaces any violations of the voice document's Evidentiary Rigor / Prose
 * Discipline rules.
 *
 * Auto-runs when the body prop changes (e.g., after generation or refine).
 * User can re-check after manual edits via the Re-check button.
 *
 * Each violation has an "Apply fix" button that hands the suggested fix
 * to the parent's onApplyFix callback (which pipes it into the Refine
 * flow), closing the critic → refine loop.
 *
 * Rule-to-label map lives here so the panel is self-describing without
 * needing the full rule definitions in the UI.
 */
const RULE_META = {
  'invented-stats':    { label: 'Invented statistics',  icon: '📊' },
  'vague-quantifier':  { label: 'Vague quantifier',     icon: '🔎' },
  'hedge':             { label: 'Hedge language',       icon: '🪞' },
  'no-position':       { label: 'No clear position',    icon: '🎯' },
  'missing-counter':   { label: 'Missing counter',      icon: '⚖️' },
  'framework':         { label: 'Framework unnamed',    icon: '🏛' },
  'prose':             { label: 'Prose discipline',     icon: '📝' },
};

const SEVERITY_STYLE = {
  high:   'border-danger/40 bg-danger/5 text-danger',
  medium: 'border-warning/40 bg-warning/5 text-warning',
  low:    'border-border bg-[#1a1a1a] text-text-secondary',
};

export default function RigorCheckPanel({ body, contentType, platform, language, onApplyFix }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dismissedIdx, setDismissedIdx] = useState(new Set());

  async function runCheck() {
    if (!body || body.length < 50) {
      setResult({ status: 'pass', summary: 'Draft too short to review meaningfully.', violations: [] });
      return;
    }
    setLoading(true);
    setError(null);
    setDismissedIdx(new Set());
    try {
      const r = await api.library.rigorCheck({ body, content_type: contentType, platform, language });
      setResult(r);
    } catch (err) {
      setError(err.message || 'Rigor check failed');
    } finally {
      setLoading(false);
    }
  }

  // Auto-run when the body changes substantively. 3-second debounce keeps
  // the critic responsive to pauses while not firing on every keystroke.
  // Also auto-run on initial mount (covers the post-generation case where
  // the critic should appear immediately alongside the fresh draft).
  useEffect(() => {
    if (!body) { setResult(null); return; }
    // On first run for a given body (no result yet), fire quickly so the
    // user sees the critic alongside the fresh generation. On subsequent
    // changes (user editing), use the 3s debounce.
    const delay = result ? 3000 : 600;
    const timer = setTimeout(() => { runCheck(); }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, language]);

  if (loading && !result) {
    return (
      <div className="card-pad border-primary/30 bg-primary/5 text-sm text-text-secondary flex items-center gap-2">
        <span className="h-1.5 w-1.5 bg-primary rounded-full animate-pulse" />
        Running rigor check…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-pad border-warning/40 bg-warning/5 text-sm text-warning flex items-center justify-between gap-3 flex-wrap">
        <span>Rigor check failed: {error}</span>
        <button className="btn-ghost text-xs" onClick={runCheck}>Retry</button>
      </div>
    );
  }

  if (!result) return null;

  const visibleViolations = (result.violations || []).filter((_, i) => !dismissedIdx.has(i));
  const status = visibleViolations.length === 0 ? 'pass' : result.status;

  const headerColor = {
    pass: 'border-success/30 bg-success/5',
    warn: 'border-warning/40 bg-warning/5',
    fail: 'border-danger/40 bg-danger/5',
  }[status] || 'border-border';
  const headerText = {
    pass: 'text-success',
    warn: 'text-warning',
    fail: 'text-danger',
  }[status] || 'text-text-secondary';

  return (
    <div className={`card-pad ${headerColor} space-y-3`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${headerText}`}>
            {status === 'pass' && '✓ Rigor check — passes'}
            {status === 'warn' && `⚠ Rigor check — ${visibleViolations.length} suggestion${visibleViolations.length === 1 ? '' : 's'}`}
            {status === 'fail' && `✕ Rigor check — ${visibleViolations.length} issue${visibleViolations.length === 1 ? '' : 's'} to address`}
          </div>
          {result.summary && (
            <div className="text-xs text-text-secondary mt-0.5">{result.summary}</div>
          )}
        </div>
        <button
          className="btn-ghost text-xs"
          onClick={runCheck}
          disabled={loading}
          title="Re-run the critic against the current draft"
        >
          {loading ? 'Checking…' : '↻ Re-check'}
        </button>
      </div>

      {visibleViolations.length > 0 && (
        <div className="space-y-2">
          {visibleViolations.map((v, i) => {
            const originalIdx = (result.violations || []).indexOf(v);
            const meta = RULE_META[v.rule] || { label: v.rule, icon: '•' };
            const sevCls = SEVERITY_STYLE[v.severity] || SEVERITY_STYLE.low;
            return (
              <div key={originalIdx} className={`rounded-md border p-3 ${sevCls}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <span>{meta.icon}</span>
                    <span>{meta.label}</span>
                    <span className="text-[10px] opacity-60 uppercase tracking-wider">· {v.severity}</span>
                  </div>
                  <button
                    className="text-[11px] opacity-60 hover:opacity-100"
                    onClick={() => setDismissedIdx((prev) => new Set([...prev, originalIdx]))}
                    title="Dismiss this warning"
                  >
                    ✕
                  </button>
                </div>
                {v.quote && (
                  <blockquote className="mt-1.5 text-xs text-text-primary/80 border-l-2 border-current/40 pl-2 italic whitespace-pre-wrap">
                    {v.quote.length > 240 ? v.quote.slice(0, 240) + '…' : v.quote}
                  </blockquote>
                )}
                {v.fix && (
                  <div className="mt-1.5 text-xs text-text-primary/90">
                    <span className="font-semibold">Fix: </span>{v.fix}
                  </div>
                )}
                {v.fix && onApplyFix && (
                  <div className="mt-2">
                    <button
                      className="btn-ghost text-[11px] !text-primary hover:!text-primary hover:bg-primary/10"
                      onClick={() => onApplyFix(v.fix)}
                      title="Pipe this fix into the Refine flow — the AI revises the draft to address this specific violation"
                    >
                      Apply fix via Refine →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

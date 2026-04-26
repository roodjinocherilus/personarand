import { useState } from 'react';
import { api } from '../../lib/api.js';
import VoiceCapture from '../common/VoiceCapture.jsx';
import { copyToClipboard } from '../../lib/clipboard.js';

/**
 * Crisis mode — the page you open when something blew up publicly and
 * you suddenly need a comms team you don't have.
 *
 * One form, one submit. The backend runs an assessment (Haiku — fast)
 * and then graded response drafts (Opus — voiced) in parallel-ish, and
 * returns both. The user picks a draft, refines it inline, and copies
 * to clipboard or saves to library via existing endpoints.
 *
 * Why no auto-save: crisis output should not be committed without a
 * deliberate review step. Saving is opt-in.
 */

const VISIBILITY_OPTIONS = ['LinkedIn', 'X', 'Press', 'Internal', 'Other'];
const TRUTH_OPTIONS = [
  { value: 'true', label: 'True (the claim is accurate)' },
  { value: 'partial', label: 'Partially true (mixed)' },
  { value: 'false', label: 'False (the claim is wrong)' },
  { value: 'unclear', label: 'Unclear (still investigating)' },
];

const SEVERITY_LABELS = {
  1: 'Noise — small ripple, no business risk',
  2: 'Visible — comments / DMs / press monitoring',
  3: 'Reputational — could hurt deals or trust',
  4: 'Material — affects revenue / partnerships',
  5: 'Legal / contractual — counsel territory',
};

const ACTION_META = {
  respond_publicly:  { label: 'Respond publicly', tone: 'primary' },
  respond_privately: { label: 'Respond privately', tone: 'warning' },
  stay_silent:       { label: 'Stay silent',      tone: 'success' },
  wait_24h:          { label: 'Wait 24 hours',    tone: 'warning' },
};

const VARIANT_META = {
  variant_a: { label: 'A · Minimal acknowledgement', description: 'Just enough to be on record. No relitigation.' },
  variant_b: { label: 'B · Full position',          description: 'States what happened, our position, why.' },
  variant_c: { label: 'C · Redirect to action',      description: 'Acknowledges, then pivots to what is being done.' },
};

const RISK_COLORS = { high: 'text-danger', medium: 'text-warning', low: 'text-text-secondary' };
const ACTION_TONE = {
  primary: 'border-primary/40 bg-primary/5 text-primary',
  warning: 'border-warning/40 bg-warning/5 text-warning',
  success: 'border-success/40 bg-success/5 text-success',
};

export default function CrisisView() {
  const [situation, setSituation] = useState({
    what_happened: '',
    visibility: [],
    severity: 3,
    involved: '',
    our_position: '',
    claim_truth: 'unclear',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [editedDraft, setEditedDraft] = useState('');
  const [savedNote, setSavedNote] = useState(null);

  function patch(p) { setSituation((s) => ({ ...s, ...p })); }
  function toggleVisibility(opt) {
    setSituation((s) => ({
      ...s,
      visibility: s.visibility.includes(opt)
        ? s.visibility.filter((v) => v !== opt)
        : [...s.visibility, opt],
    }));
  }

  async function submit() {
    if (situation.what_happened.trim().length < 30) {
      setError('Describe the situation in at least 30 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    setResult(null);
    setSelectedVariant(null);
    setSavedNote(null);
    try {
      const r = await api.crisis.assess(situation);
      setResult(r);
    } catch (e) {
      setError(e.message || 'Assessment failed');
    } finally {
      setBusy(false);
    }
  }

  function pickVariant(key) {
    setSelectedVariant(key);
    setEditedDraft(result?.drafts?.[key] || '');
  }

  async function copyDraft() {
    const ok = await copyToClipboard(editedDraft);
    setSavedNote(ok ? 'Copied to clipboard.' : 'Copy failed — select and copy manually.');
  }

  async function saveToLibrary() {
    if (!editedDraft || editedDraft.trim().length < 10) {
      setSavedNote('Draft is empty — nothing to save.');
      return;
    }
    try {
      const firstLine = editedDraft.trim().split(/\n+/)[0].slice(0, 60);
      await api.crisis.saveDraft({
        title: `[Crisis] ${firstLine}`,
        body: editedDraft.trim(),
        platform: result?.assessment?.if_respond?.channel || 'LinkedIn',
        content_type: 'article',
      });
      setSavedNote('Saved to Library with [Crisis] tag.');
    } catch (e) {
      setSavedNote(e.message || 'Save failed.');
    }
  }

  function reset() {
    setResult(null);
    setSelectedVariant(null);
    setEditedDraft('');
    setSavedNote(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-[11px] uppercase tracking-widest text-danger">Crisis mode</div>
        <h1 className="text-2xl font-semibold mt-1">Respond under pressure</h1>
        <p className="text-text-secondary text-sm mt-2 max-w-3xl leading-relaxed">
          One form, one submit. The AI assesses the situation, recommends an action, names the risks of each path, and (when appropriate) drafts three graded response options in your voice. Nothing auto-publishes. You pick, edit, copy, or save.
        </p>
      </div>

      {!result && (
        <SituationForm
          situation={situation}
          patch={patch}
          toggleVisibility={toggleVisibility}
          busy={busy}
          error={error}
          onSubmit={submit}
        />
      )}

      {result && (
        <>
          <Assessment assessment={result.assessment} />

          {result.skipped_drafts && (
            <div className="card-pad border-success/40 bg-success/5">
              <div className="text-success font-semibold">Drafts skipped intentionally.</div>
              <div className="text-xs text-text-secondary mt-1 leading-relaxed">
                The assessment recommends not posting right now. Drafting was suppressed so you don't have a finished response sitting on your screen tempting an early send. If facts move and you decide to respond, run a new assessment.
              </div>
            </div>
          )}

          {result.drafts && (
            <DraftPicker
              drafts={result.drafts}
              selected={selectedVariant}
              onPick={pickVariant}
            />
          )}

          {selectedVariant && (
            <div className="card-pad space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm font-semibold">Editing: {VARIANT_META[selectedVariant]?.label}</div>
                  <div className="text-[11px] text-text-secondary mt-0.5">{VARIANT_META[selectedVariant]?.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <VoiceCapture value={editedDraft} onChange={setEditedDraft} />
                  <span className="text-[11px] text-text-secondary font-mono whitespace-nowrap">
                    {editedDraft.length} chars
                  </span>
                </div>
              </div>
              <textarea
                className="input min-h-[260px] text-sm"
                value={editedDraft}
                onChange={(e) => setEditedDraft(e.target.value)}
              />
              <div className="flex flex-wrap gap-2 justify-end">
                <button className="btn-ghost text-xs" onClick={() => setSelectedVariant(null)}>← Pick a different variant</button>
                <button className="btn-ghost text-xs" onClick={copyDraft}>Copy</button>
                <button className="btn-primary text-xs" onClick={saveToLibrary}>Save to Library</button>
              </div>
              {savedNote && (
                <div className={`text-xs ${savedNote.includes('failed') || savedNote.includes('refused') ? 'text-warning' : 'text-success'}`}>{savedNote}</div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button className="btn-ghost text-xs" onClick={reset}>← Start a new assessment</button>
          </div>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// SituationForm
// -----------------------------------------------------------------------------

function SituationForm({ situation, patch, toggleVisibility, busy, error, onSubmit }) {
  return (
    <div className="space-y-4">
      <div className="card-pad space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold">What happened</div>
          <VoiceCapture value={situation.what_happened} onChange={(v) => patch({ what_happened: v })} placeholderHint="speak the situation" />
        </div>
        <textarea
          className="input min-h-[140px] text-sm"
          placeholder="Describe what happened, who said what, where it appeared, how it's spreading. Be factual, not editorial."
          value={situation.what_happened}
          onChange={(e) => patch({ what_happened: e.target.value })}
          disabled={busy}
        />
      </div>

      <div className="card-pad space-y-2">
        <div className="text-sm font-semibold">Where is it visible?</div>
        <div className="flex flex-wrap gap-2">
          {VISIBILITY_OPTIONS.map((v) => {
            const active = situation.visibility.includes(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => toggleVisibility(v)}
                disabled={busy}
                className={`pill ${active ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card-pad space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Severity</div>
          <span className="font-mono text-xs text-text-secondary">{situation.severity}/5</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={situation.severity}
          onChange={(e) => patch({ severity: Number(e.target.value) })}
          disabled={busy}
          className="w-full"
        />
        <div className="text-[11px] text-text-secondary">{SEVERITY_LABELS[situation.severity]}</div>
      </div>

      <div className="card-pad space-y-2">
        <div className="text-sm font-semibold">Who's involved?</div>
        <input
          className="input text-sm"
          placeholder="Named people, companies, accounts. Comma-separated."
          value={situation.involved}
          onChange={(e) => patch({ involved: e.target.value })}
          disabled={busy}
        />
      </div>

      <div className="card-pad space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold">Our actual position / our truth</div>
          <VoiceCapture value={situation.our_position} onChange={(v) => patch({ our_position: v })} />
        </div>
        <textarea
          className="input min-h-[100px] text-sm"
          placeholder="What's actually true from your side? The thing you would want recorded if you had to defend this in 6 months."
          value={situation.our_position}
          onChange={(e) => patch({ our_position: e.target.value })}
          disabled={busy}
        />
      </div>

      <div className="card-pad space-y-2">
        <div className="text-sm font-semibold">Is the underlying claim true?</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TRUTH_OPTIONS.map((opt) => {
            const active = situation.claim_truth === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => patch({ claim_truth: opt.value })}
                disabled={busy}
                className={`text-left rounded-md border p-3 text-sm transition-colors ${
                  active
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border bg-[#161616] hover:border-text-secondary'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="card-pad border-danger/40 bg-danger/5 text-sm text-danger">{error}</div>
      )}

      <div className="flex justify-end">
        <button
          className="btn-primary"
          onClick={onSubmit}
          disabled={busy || situation.what_happened.trim().length < 30}
        >
          {busy ? 'Assessing… (Haiku) → drafting (Opus)' : 'Assess and draft →'}
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Assessment
// -----------------------------------------------------------------------------

function Assessment({ assessment }) {
  if (!assessment) return null;
  const meta = ACTION_META[assessment.primary_action] || { label: assessment.primary_action, tone: 'primary' };
  const respond = assessment.if_respond || {};
  return (
    <div className={`card-pad ${ACTION_TONE[meta.tone]} space-y-3`}>
      <div>
        <div className="text-[11px] uppercase tracking-widest opacity-80">Recommendation</div>
        <div className="text-lg font-semibold mt-1">{meta.label}</div>
      </div>
      <div className="text-sm text-text-primary leading-relaxed">{assessment.reasoning}</div>

      {(respond.channel || respond.tone || respond.timing) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <KV label="Channel" value={respond.channel} />
          <KV label="Tone" value={respond.tone} />
          <KV label="Timing" value={respond.timing} />
        </div>
      )}

      {Array.isArray(assessment.risks) && assessment.risks.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-current/20">
          <div className="text-[11px] uppercase tracking-widest opacity-80">Risks</div>
          {assessment.risks.map((r, i) => (
            <div key={i} className="text-xs leading-relaxed">
              <span className={`${RISK_COLORS[r.likelihood] || ''} font-semibold uppercase tracking-wider mr-2 text-[10px]`}>{r.likelihood}</span>
              <span className="text-text-primary">{r.scenario}</span>
              {r.mitigation && <div className="text-text-secondary ml-12 mt-0.5">→ {r.mitigation}</div>}
            </div>
          ))}
        </div>
      )}

      {Array.isArray(assessment.what_to_avoid) && assessment.what_to_avoid.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-current/20">
          <div className="text-[11px] uppercase tracking-widest opacity-80">What to avoid</div>
          {assessment.what_to_avoid.map((item, i) => (
            <div key={i} className="text-xs text-text-primary leading-relaxed">— {item}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div className="rounded-md border border-current/20 p-2">
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-sm mt-0.5 text-text-primary">{value || '—'}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// DraftPicker
// -----------------------------------------------------------------------------

function DraftPicker({ drafts, selected, onPick }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">Three graded response variants</div>
      <div className="text-[11px] text-text-secondary">Each variant uses your voice profile and follows the assessment's directives. Pick one to edit.</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {Object.entries(VARIANT_META).map(([key, meta]) => {
          const text = drafts[key] || '';
          const active = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={`text-left card-pad transition-colors ${
                active ? 'border-primary/60 bg-primary/10' : 'hover:border-text-secondary'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{meta.label}</div>
                {active && <span className="text-[10px] uppercase tracking-wider text-primary">Editing</span>}
              </div>
              <div className="text-[11px] text-text-secondary mt-0.5">{meta.description}</div>
              <div className="text-xs text-text-primary mt-2 leading-relaxed line-clamp-[12] whitespace-pre-wrap">
                {text}
              </div>
              <div className="text-[10px] text-text-secondary mt-2 font-mono">{text.length} chars</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

/**
 * Voice Profile builder — the page where the user fills in (or imports)
 * the structured voice document that drives every AI generation.
 *
 * Three input modes, all stacked on one screen so the user can mix them:
 *
 *   1. Edit fields directly
 *      The form. Always visible. Each dimension renders based on its kind:
 *      `text` (textarea), `list` (string array editor), `pairs` (two-field
 *      array editor). Save is explicit so partial edits never collide
 *      with auto-save races.
 *
 *   2. Paste from AI
 *      The user copies the canonical extraction prompt, pastes it into
 *      ChatGPT / Claude / whichever AI they use heavily, then pastes the
 *      JSON response back here. We parse it and MERGE into the form
 *      (without overwriting fields the user has already filled).
 *
 *   3. Extract from corpus
 *      Paste past content (posts, essays, transcripts). Haiku reads it
 *      and proposes a draft. Same merge behavior.
 *
 * Score panel at the top shows the current completeness grade. "Re-score"
 * triggers Haiku to grade each dimension and persists the result so the
 * Dashboard widget reflects it on next page load.
 */

const SOURCE_MODE_LABELS = {
  default: 'Default voice',
  questionnaire: 'Questionnaire',
  'ai-extraction': 'AI extraction',
  corpus: 'Corpus extraction',
  mixed: 'Mixed sources',
};

export default function VoiceProfileView() {
  const [dimensions, setDimensions] = useState([]);
  const [profile, setProfile] = useState(null);
  const [localScore, setLocalScore] = useState(null);
  const [cachedScore, setCachedScore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [activeImportTab, setActiveImportTab] = useState(null); // 'ai' | 'corpus' | null
  const [compliancePacks, setCompliancePacks] = useState([]);
  const [archetypes, setArchetypes] = useState([]);
  const [archetypeBusy, setArchetypeBusy] = useState(null); // id being applied
  const [importBusy, setImportBusy] = useState(false);
  const importInputRef = useRef(null);

  // Import-tab state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponseText, setAiResponseText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [corpusText, setCorpusText] = useState('');
  const [corpusBusy, setCorpusBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.voiceProfile.dimensions().catch(() => ({ dimensions: [] })),
      api.voiceProfile.get().catch(() => null),
      api.voiceProfile.extractionPrompt().catch(() => ({ prompt: '' })),
      api.voiceProfile.compliancePacks().catch(() => ({ packs: [] })),
      api.voiceProfile.archetypes().catch(() => ({ archetypes: [] })),
    ]).then(([dims, prof, ext, packs, archs]) => {
      if (!mounted) return;
      setDimensions(dims.dimensions || []);
      if (prof) {
        setProfile(prof.profile);
        setLocalScore(prof.local_score);
        setCachedScore(prof.cached_score);
      }
      setAiPrompt(ext.prompt || '');
      setCompliancePacks(packs.packs || []);
      setArchetypes(archs.archetypes || []);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const isDirty = useMemo(() => {
    // Trivial dirty flag — any state change since load. The "Save" button
    // disables when not dirty so the user has a clear save signal.
    return profile && profile.__dirty === true;
  }, [profile]);

  function patchProfile(patch) {
    setProfile((p) => ({ ...(p || {}), ...patch, __dirty: true }));
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // Strip the dirty marker before sending. The backend ignores unknown
      // fields anyway, but staying tidy keeps logs clean.
      const { __dirty, id, created_at, updated_at, score_total, score_breakdown, score_at, is_primary, ...payload } = profile;
      const r = await api.voiceProfile.save(payload);
      setProfile(r.profile);
      setLocalScore(r.local_score);
      setCachedScore(r.cached_score);
      setNotice('Saved. The next generation will use this voice.');
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleScore() {
    setScoring(true);
    setError(null);
    setNotice(null);
    try {
      // Save first if there are unsaved changes — score should reflect
      // what's persisted, not what's in the textarea.
      if (isDirty) await handleSave();
      const r = await api.voiceProfile.score();
      if (r.error) {
        // 502 with local fallback comes through here as an unusual shape;
        // treat as soft error.
        setError(r.error);
      } else {
        setCachedScore({ total: r.total, breakdown: r.breakdown, at: r.at });
        setNotice(`Scored: ${r.total}%. Breakdown updated.`);
      }
    } catch (e) {
      setError(e.message || 'Scoring failed');
    } finally {
      setScoring(false);
    }
  }

  async function handleParseAi() {
    if (!aiResponseText.trim()) return;
    setAiBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.voiceProfile.parseAiResponse(aiResponseText);
      mergeDraft(r.draft, 'ai-extraction');
      setNotice('AI extraction merged into the form. Review, edit, then save.');
      setActiveImportTab(null);
      setAiResponseText('');
    } catch (e) {
      setError(e.message || 'Parse failed');
    } finally {
      setAiBusy(false);
    }
  }

  function handleExport() {
    api.voiceProfile.export().catch((e) => setError(e.message || 'Export failed'));
  }

  async function handleImportFile(file) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setImportBusy(true);
    try {
      const text = await file.text();
      let payload;
      try { payload = JSON.parse(text); }
      catch { throw new Error('Selected file is not valid JSON.'); }
      if (payload.kind !== 'voice-profile') {
        throw new Error(`Wrong file kind: expected "voice-profile", got "${payload.kind || 'unknown'}".`);
      }
      const r = await api.voiceProfile.import(payload);
      setProfile(r.profile);
      setLocalScore(r.local_score);
      setCachedScore(r.cached_score);
      setNotice('Profile imported. The next generation will use this voice.');
    } catch (e) {
      setError(e.message || 'Import failed');
    } finally {
      setImportBusy(false);
      // Reset the input so selecting the same file twice still fires onChange.
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function handleApplyArchetype(id) {
    setError(null);
    setNotice(null);
    setArchetypeBusy(id);
    try {
      const r = await api.voiceProfile.archetype(id);
      // Reuse mergeDraft so the user's existing edits aren't overwritten.
      // Source mode tag becomes 'questionnaire' on first apply (it's a
      // structured starter, not an extraction).
      mergeDraft(r.starter, 'questionnaire');
      setNotice(`Applied archetype "${r.label}". Review the form and save when you've customized it to fit.`);
    } catch (e) {
      setError(e.message || 'Failed to apply archetype');
    } finally {
      setArchetypeBusy(null);
    }
  }

  async function handleExtractCorpus() {
    if (corpusText.trim().length < 200) {
      setError('Paste at least 200 characters of past content first.');
      return;
    }
    setCorpusBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.voiceProfile.extractFromCorpus(corpusText, profile?.display_name);
      mergeDraft(r.draft, 'corpus');
      setNotice('Corpus extraction merged into the form. Review, edit, then save.');
      setActiveImportTab(null);
      setCorpusText('');
    } catch (e) {
      setError(e.message || 'Extraction failed');
    } finally {
      setCorpusBusy(false);
    }
  }

  /**
   * Merge an extracted draft into the current profile WITHOUT overwriting
   * fields the user has already filled. For arrays we union (de-duped on
   * lowercased trim). For text fields we only set when empty.
   */
  function mergeDraft(draft, sourceTag) {
    setProfile((prev) => {
      const next = { ...(prev || {}), __dirty: true };
      const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim().length === 0) || (Array.isArray(v) && v.length === 0);

      // Text fields
      for (const key of ['display_name', 'core_thesis', 'strategic_horizon', 'regional_context']) {
        if (typeof draft[key] === 'string' && isEmpty(next[key])) next[key] = draft[key];
      }

      // List fields — union with existing.
      for (const key of ['stand_for', 'stand_against', 'voice_laws', 'anti_voice']) {
        const incoming = Array.isArray(draft[key]) ? draft[key] : [];
        const existing = Array.isArray(next[key]) ? next[key] : [];
        const seen = new Set(existing.map((s) => String(s || '').trim().toLowerCase()));
        const merged = [...existing];
        for (const item of incoming) {
          const k = String(item || '').trim().toLowerCase();
          if (k && !seen.has(k)) {
            merged.push(item);
            seen.add(k);
          }
        }
        next[key] = merged;
      }

      // Pair fields — de-dupe by primary key (domain / name / audience).
      const pairKeyByField = { domains_of_authority: 'domain', frameworks: 'name', primary_audiences: 'audience' };
      for (const [key, primary] of Object.entries(pairKeyByField)) {
        const incoming = Array.isArray(draft[key]) ? draft[key] : [];
        const existing = Array.isArray(next[key]) ? next[key] : [];
        const seen = new Set(existing.map((p) => String(p?.[primary] || '').trim().toLowerCase()));
        const merged = [...existing];
        for (const p of incoming) {
          const k = String(p?.[primary] || '').trim().toLowerCase();
          if (k && !seen.has(k)) {
            merged.push(p);
            seen.add(k);
          }
        }
        next[key] = merged;
      }

      // Track that this profile has multiple sources now.
      const prevMode = prev?.source_mode;
      if (!prevMode || prevMode === 'default') next.source_mode = sourceTag;
      else if (prevMode !== sourceTag) next.source_mode = 'mixed';

      return next;
    });
  }

  if (loading) return <div className="text-text-secondary text-sm">Loading voice profile…</div>;
  if (!profile) return <div className="text-text-secondary text-sm">No profile available.</div>;

  const score = cachedScore || localScore;
  const total = score?.total || 0;
  const isAiScored = !!cachedScore;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-[11px] uppercase tracking-widest text-text-secondary">Voice profile</div>
        <h1 className="text-2xl font-semibold mt-1">Brand voice document</h1>
        <p className="text-text-secondary text-sm mt-2 max-w-3xl leading-relaxed">
          The structured voice document that gets compiled into the system prompt for every generation. Fill it directly, paste from your existing AI, or extract from past content. The completeness score is the single sharpest signal of how distinctive your generated content will sound.
        </p>
      </div>

      {/* Score panel */}
      <ScorePanel
        total={total}
        isAiScored={isAiScored}
        breakdown={score?.breakdown || {}}
        sourceMode={profile.source_mode}
        onRescore={handleScore}
        scoring={scoring}
      />

      {/* Notices */}
      {error && (
        <div className="card-pad border-danger/40 bg-danger/5 text-sm text-danger">{error}</div>
      )}
      {notice && (
        <div className="card-pad border-success/40 bg-success/5 text-sm text-success">{notice}</div>
      )}

      {/* Import strip */}
      <div className="card-pad">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Import a draft</div>
            <div className="text-xs text-text-secondary mt-0.5">
              Faster than typing every field. Imports merge — they never overwrite what you've already filled.
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              className={`btn-ghost text-xs ${activeImportTab === 'ai' ? '!text-primary' : ''}`}
              onClick={() => setActiveImportTab(activeImportTab === 'ai' ? null : 'ai')}
            >
              {activeImportTab === 'ai' ? '✕ Close' : 'Paste from AI →'}
            </button>
            <button
              className={`btn-ghost text-xs ${activeImportTab === 'corpus' ? '!text-primary' : ''}`}
              onClick={() => setActiveImportTab(activeImportTab === 'corpus' ? null : 'corpus')}
            >
              {activeImportTab === 'corpus' ? '✕ Close' : 'Extract from corpus →'}
            </button>
          </div>
        </div>

        {activeImportTab === 'ai' && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="text-xs text-text-secondary leading-relaxed">
              Copy this prompt, paste it into the AI you already use heavily (ChatGPT / Claude / Gemini). Then paste its JSON response in the second box.
            </div>
            <div className="flex flex-col gap-2">
              <textarea
                readOnly
                value={aiPrompt}
                className="input-base min-h-[160px] font-mono text-[11px] leading-relaxed"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    navigator.clipboard?.writeText(aiPrompt);
                    setNotice('Extraction prompt copied to clipboard.');
                  }}
                >
                  Copy prompt
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-text-secondary">Paste your AI's JSON response below:</label>
              <textarea
                className="input-base min-h-[180px] font-mono text-[11px]"
                placeholder='{"core_thesis": "...", "stand_for": [...], ...}'
                value={aiResponseText}
                onChange={(e) => setAiResponseText(e.target.value)}
              />
              <div className="flex justify-end">
                <button
                  className="btn-primary text-xs"
                  disabled={aiBusy || !aiResponseText.trim()}
                  onClick={handleParseAi}
                >
                  {aiBusy ? 'Parsing…' : 'Parse and merge into form →'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeImportTab === 'corpus' && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="text-xs text-text-secondary leading-relaxed">
              Paste past content — recent posts, an essay, a talk transcript. Haiku reads it and proposes a starter profile. The merge will not overwrite fields you've already filled.
            </div>
            <textarea
              className="input-base min-h-[200px] text-xs"
              placeholder="Paste 5–20 past posts, an essay, or a transcript. Min 200 characters."
              value={corpusText}
              onChange={(e) => setCorpusText(e.target.value)}
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-text-secondary font-mono">
                {corpusText.length.toLocaleString()} characters
                {corpusText.length < 200 && ' — needs ≥ 200'}
              </div>
              <button
                className="btn-primary text-xs"
                disabled={corpusBusy || corpusText.trim().length < 200}
                onClick={handleExtractCorpus}
              >
                {corpusBusy ? 'Extracting…' : 'Extract and merge →'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Archetype starter picker — shown when the profile is mostly empty
          so a new user can populate 80% of the document in two clicks
          and then customize. Hidden once the profile has substance. */}
      {(profile.core_thesis || '').trim().length < 30 && archetypes.length > 0 && (
        <div className="card-pad border-primary/30 bg-primary/5 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-primary">Cold-start shortcut</div>
            <div className="text-sm font-semibold mt-1">Start from an archetype</div>
            <div className="text-[11px] text-text-secondary mt-1 max-w-2xl leading-relaxed">
              Pick the operator archetype that fits closest. The form pre-fills with a sharp starter voice — replace anything that doesn't match. Faster than typing every dimension; sharper than a blank page.
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {archetypes.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => handleApplyArchetype(a.id)}
                disabled={!!archetypeBusy}
                className="text-left rounded-md border border-border bg-card hover:border-primary p-3 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-base">{a.icon}</span>
                  <div className="text-sm font-semibold">{a.label}</div>
                  {archetypeBusy === a.id && <span className="text-[10px] text-primary ml-auto">applying…</span>}
                </div>
                <div className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{a.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Display name */}
      <div className="card-pad space-y-2">
        <div className="text-xs uppercase tracking-wider text-text-secondary">Identity</div>
        <label className="text-sm font-medium">Display name</label>
        <input
          className="input-base"
          placeholder="Your name as it should appear in the AI's voice document"
          value={profile.display_name || ''}
          onChange={(e) => patchProfile({ display_name: e.target.value })}
        />
        <div className="text-[11px] text-text-secondary">
          Source: {SOURCE_MODE_LABELS[profile.source_mode] || profile.source_mode || 'unknown'}
        </div>
      </div>

      {/* Compliance pack — opt-in rule sets that extend the rigor critic.
          Most users pick "generic" (no extra rules); regulated executives
          pick the matching pack. The pack is layered ON TOP of the
          universal rigor rules + the user's own voice laws — never
          replaces them. */}
      <CompliancePackPicker
        packs={compliancePacks}
        current={profile.compliance_pack}
        onChange={(packId) => patchProfile({ compliance_pack: packId === 'generic' ? null : packId })}
      />

      {/* Dimension forms */}
      <div className="space-y-4">
        {dimensions.map((dim) => (
          <DimensionEditor
            key={dim.key}
            dim={dim}
            value={profile[dim.key]}
            score={score?.breakdown?.[dim.key]}
            onChange={(v) => patchProfile({ [dim.key]: v })}
          />
        ))}
      </div>

      {/* Backup — export current profile as JSON, import from a previous
          export. Import REPLACES the profile (it's restoration, not
          merging). Useful for: backup peace of mind, sharing voice
          documents between teammates, restoring after an experiment. */}
      <div className="card-pad space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-text-secondary">Backup</div>
          <div className="text-sm font-semibold mt-1">Export / import profile</div>
          <div className="text-[11px] text-text-secondary mt-1 max-w-2xl leading-relaxed">
            Your voice document is your data — download it any time, restore it on a fresh install, hand it to a teammate. Import REPLACES the current profile completely; if you want merging, use the AI / corpus / archetype paths instead.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={handleExport}>
            ⬇ Export profile (JSON)
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={importBusy}
            onClick={() => importInputRef.current?.click()}
          >
            {importBusy ? 'Importing…' : '⬆ Import profile (JSON)'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => handleImportFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-3 z-10 flex justify-end">
        <div className="card-pad flex items-center gap-3 bg-card/95 backdrop-blur shadow-lg">
          {isDirty && (
            <span className="text-xs text-warning">Unsaved changes</span>
          )}
          {!isDirty && cachedScore && (
            <span className="text-xs text-text-secondary">No unsaved changes</span>
          )}
          <button
            className="btn-primary text-xs"
            disabled={saving || !isDirty}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Score panel
// -----------------------------------------------------------------------------

// Tailwind JIT requires literal class names — no runtime interpolation.
const TIER_STYLES = {
  strong:      { container: 'border-success/40 bg-success/5', text: 'text-success', bar: 'bg-success', label: 'Strong' },
  serviceable: { container: 'border-primary/40 bg-primary/5', text: 'text-primary', bar: 'bg-primary', label: 'Serviceable' },
  thin:        { container: 'border-warning/40 bg-warning/5', text: 'text-warning', bar: 'bg-warning', label: 'Thin' },
  critical:    { container: 'border-danger/40 bg-danger/5',   text: 'text-danger',  bar: 'bg-danger',  label: 'Critical gap' },
};
const DIM_STYLES = {
  success: { text: 'text-success', bar: 'bg-success' },
  primary: { text: 'text-primary', bar: 'bg-primary' },
  warning: { text: 'text-warning', bar: 'bg-warning' },
  danger:  { text: 'text-danger',  bar: 'bg-danger'  },
};

function pickTier(total) {
  if (total >= 80) return 'strong';
  if (total >= 60) return 'serviceable';
  if (total >= 40) return 'thin';
  return 'critical';
}
function pickDimColor(pct) {
  if (pct >= 80) return 'success';
  if (pct >= 50) return 'primary';
  if (pct >= 25) return 'warning';
  return 'danger';
}

function ScorePanel({ total, isAiScored, breakdown, sourceMode, onRescore, scoring }) {
  const tier = pickTier(total);
  const tierMeta = TIER_STYLES[tier];

  // Show all 10 dims, not just 3, on this page — this is the full editor.
  const dims = Object.entries(breakdown).map(([key, b]) => ({ key, ...b }));

  return (
    <div className={`card-pad ${tierMeta.container} space-y-3`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className={`text-sm font-semibold ${tierMeta.text}`}>
            Completeness — {total}% {isAiScored ? '· AI-graded' : '· local heuristic'}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">
            Tier: <span className={tierMeta.text}>{tierMeta.label}</span>
            {sourceMode && sourceMode !== 'default' && <> · Source: {SOURCE_MODE_LABELS[sourceMode] || sourceMode}</>}
          </div>
        </div>
        <button
          className="btn-ghost text-xs"
          onClick={onRescore}
          disabled={scoring}
          title="Run the Haiku critic against the current profile"
        >
          {scoring ? 'Scoring…' : '↻ Re-score with AI'}
        </button>
      </div>

      <div className="h-2 rounded-full bg-[#1f1f1f] overflow-hidden">
        <div className={`h-full ${tierMeta.bar} transition-all`} style={{ width: `${total}%` }} />
      </div>

      {dims.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {dims.map((d) => {
            const pct = d.weight ? Math.round(((d.weighted || 0) / d.weight) * 100) : 0;
            const dimStyle = DIM_STYLES[pickDimColor(pct)];
            return (
              <div key={d.key} className="rounded-md border border-border bg-card p-2">
                <div className="text-[10px] uppercase tracking-wider text-text-secondary truncate" title={d.label}>{d.label || d.key}</div>
                <div className={`mt-1 text-sm font-mono ${dimStyle.text}`}>{pct}%</div>
                <div className="mt-1 h-0.5 rounded-full bg-[#1f1f1f] overflow-hidden">
                  <div className={`h-full ${dimStyle.bar}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Dimension editor — renders based on dim.kind
// -----------------------------------------------------------------------------

function DimensionEditor({ dim, value, score, onChange }) {
  return (
    <div className="card-pad space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{dim.label}</div>
          <div className="text-[11px] text-text-secondary mt-0.5 max-w-2xl leading-relaxed">{dim.hint}</div>
        </div>
        <div className="text-[11px] text-text-secondary text-right whitespace-nowrap">
          Weight {dim.weight}
          {score && <span className="ml-2 font-mono">{score.score ?? 0}/100</span>}
        </div>
      </div>

      {dim.kind === 'text' && (
        <textarea
          className="input-base min-h-[100px] text-sm"
          placeholder={dim.hint}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {dim.kind === 'list' && (
        <ListEditor value={Array.isArray(value) ? value : []} onChange={onChange} />
      )}

      {dim.kind === 'pairs' && (
        <PairsEditor
          value={Array.isArray(value) ? value : []}
          pairKeys={dim.pairKeys || []}
          onChange={onChange}
        />
      )}

      {score?.note && (
        <div className="text-[11px] text-text-secondary border-l-2 border-border pl-2 italic">
          AI critic: {score.note}
        </div>
      )}
    </div>
  );
}

function CompliancePackPicker({ packs, current, onChange }) {
  if (!packs || packs.length === 0) return null;
  const currentId = current || 'generic';
  return (
    <div className="card-pad space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wider text-text-secondary">Compliance pack</div>
        <div className="text-[11px] text-text-secondary mt-1 max-w-2xl leading-relaxed">
          Pre-defined rule sets the rigor critic will enforce in addition to your voice laws and the universal rigor rules. Pick the pack that matches your professional context. Most users leave this on "Generic operator" — only enable a pack if you operate under specific compliance constraints.
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {packs.map((pack) => {
          const active = pack.id === currentId;
          return (
            <button
              key={pack.id}
              type="button"
              onClick={() => onChange(pack.id)}
              className={`text-left rounded-md border p-3 transition-colors ${
                active
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border bg-[#161616] hover:border-text-secondary'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{pack.label}</div>
                {active && <span className="text-[10px] uppercase tracking-wider text-primary">Active</span>}
              </div>
              <div className="text-[11px] text-text-secondary mt-1 leading-relaxed">{pack.description}</div>
              {pack.rule_count > 0 && (
                <div className="text-[10px] text-text-secondary mt-2 font-mono">
                  {pack.rule_count} rule{pack.rule_count === 1 ? '' : 's'}: {pack.rule_codes.join(', ')}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ListEditor({ value, onChange }) {
  function setAt(i, v) {
    const next = [...value];
    next[i] = v;
    onChange(next);
  }
  function removeAt(i) {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  }
  function add() {
    onChange([...(value || []), '']);
  }
  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div key={i} className="flex gap-2 items-start">
          <input
            className="input-base text-sm flex-1"
            value={item || ''}
            onChange={(e) => setAt(i, e.target.value)}
          />
          <button
            type="button"
            className="text-text-secondary hover:text-danger text-xs px-2 py-2"
            onClick={() => removeAt(i)}
            title="Remove"
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost text-xs" onClick={add}>+ Add item</button>
    </div>
  );
}

function PairsEditor({ value, pairKeys, onChange }) {
  function setPairAt(i, key, v) {
    const next = value.map((p, idx) => (idx === i ? { ...p, [key]: v } : p));
    onChange(next);
  }
  function removeAt(i) {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  }
  function add() {
    const blank = {};
    for (const k of pairKeys) blank[k] = '';
    onChange([...(value || []), blank]);
  }
  return (
    <div className="space-y-2">
      {value.map((p, i) => (
        <div key={i} className="rounded-md border border-border bg-[#161616] p-3 space-y-2">
          {pairKeys.map((k) => (
            <div key={k} className="flex gap-2 items-center">
              <label className="text-[11px] text-text-secondary uppercase tracking-wider w-24 flex-shrink-0">{k.replace(/_/g, ' ')}</label>
              <input
                className="input-base text-sm flex-1"
                value={p?.[k] || ''}
                onChange={(e) => setPairAt(i, k, e.target.value)}
              />
            </div>
          ))}
          <div className="flex justify-end">
            <button
              type="button"
              className="text-text-secondary hover:text-danger text-xs"
              onClick={() => removeAt(i)}
            >
              ✕ Remove
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn-ghost text-xs" onClick={add}>+ Add entry</button>
    </div>
  );
}

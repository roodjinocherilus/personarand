import { useState } from 'react';
import { api } from '../../lib/api.js';

/**
 * Captures the version the user ACTUALLY posted after any edits they made
 * to the AI draft. The delta between `body` (what AI wrote) and
 * `posted_version_en` (what got posted) is the sharpest training signal in
 * the entire system — it's literal "what Roodjino changes that Claude
 * gets wrong."
 *
 * Non-blocking UX: the user can skip, say "posted as-is", or paste the
 * edited version. Only the edit case feeds back to future generations.
 */
export default function PostedVersionPanel({ row, onSaved }) {
  const [mode, setMode] = useState('prompt'); // 'prompt' | 'editing' | 'done'
  const [draftEn, setDraftEn] = useState(row.body || '');
  const [draftFr, setDraftFr] = useState(row.body_fr || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // If we've already collected a posted version for this row, don't nag.
  if (row.posted_version_en || row.posted_version_fr) return null;

  async function save(payload) {
    setBusy(true);
    setError(null);
    try {
      await api.library.update(row.id, payload);
      setMode('done');
      if (onSaved) onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function savePostedAsIs() {
    // "As-is" = posted_version equals body. We mark both to prevent the
    // prompt from re-appearing and to tell the feedback loop "no edit signal".
    save({
      posted_version_en: row.body || '',
      ...(row.body_fr ? { posted_version_fr: row.body_fr } : {}),
    });
  }

  function saveEditedVersion() {
    // At least one language must differ from the AI draft — otherwise it's
    // effectively "posted as-is".
    const enChanged = draftEn && draftEn !== row.body;
    const frChanged = draftFr && draftFr !== (row.body_fr || '');
    if (!enChanged && !frChanged) {
      setError('The pasted version is identical to the AI draft. Click "Posted as-is" instead, or make changes.');
      return;
    }
    save({
      posted_version_en: draftEn,
      ...(row.body_fr !== undefined ? { posted_version_fr: draftFr || null } : {}),
    });
  }

  if (mode === 'done') {
    return (
      <div className="px-4 py-2.5 border-t border-success/40 bg-success/10 text-xs text-success">
        ✓ Captured. The AI will reference this edit on the next generation.
      </div>
    );
  }

  if (mode === 'editing') {
    const hasFr = Boolean(row.body_fr);
    return (
      <div className="px-4 py-3 border-t border-primary/40 bg-primary/5 space-y-3">
        <div className="text-sm text-primary font-semibold">
          Paste the final version you posted — this teaches the AI what you change
        </div>
        <div className="text-[11px] text-text-secondary leading-relaxed">
          Only the differences from the AI draft feed back into future generations. Lines you kept are ignored; lines you edited are the training signal.
        </div>
        <div>
          <div className="label">🇬🇧 Final EN version (what you posted)</div>
          <textarea
            className="input font-mono text-xs min-h-[140px]"
            value={draftEn}
            onChange={(e) => setDraftEn(e.target.value)}
          />
        </div>
        {hasFr && (
          <div>
            <div className="label">🇫🇷 Final FR version (what you posted)</div>
            <textarea
              className="input font-mono text-xs min-h-[140px]"
              value={draftFr}
              onChange={(e) => setDraftFr(e.target.value)}
            />
          </div>
        )}
        {error && <div className="text-danger text-xs">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost text-xs" onClick={() => setMode('prompt')}>Back</button>
          <button className="btn-primary text-xs" onClick={saveEditedVersion} disabled={busy}>
            {busy ? 'Saving…' : 'Save my final version'}
          </button>
        </div>
      </div>
    );
  }

  // mode === 'prompt'
  return (
    <div className="px-4 py-3 border-t border-primary/40 bg-primary/5 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-primary font-semibold">Did you edit this before posting?</div>
        <div className="text-[11px] text-text-secondary leading-relaxed mt-0.5">
          The AI learns from the edits you make. Share the final version and every future generation absorbs the correction.
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn text-xs" onClick={savePostedAsIs} disabled={busy}>
          Posted as-is
        </button>
        <button className="btn-primary text-xs" onClick={() => setMode('editing')} disabled={busy}>
          I edited it →
        </button>
      </div>
      {error && <div className="text-danger text-xs w-full">{error}</div>}
    </div>
  );
}

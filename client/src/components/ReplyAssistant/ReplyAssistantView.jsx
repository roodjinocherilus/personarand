import { useState } from 'react';
import { api } from '../../lib/api.js';
import VoiceCapture from '../common/VoiceCapture.jsx';
import { copyToClipboard } from '../../lib/clipboard.js';

/**
 * Reply Assistant — drafts in-voice replies to inbound messages.
 *
 * Different from Crisis (public reputational situations) and from
 * Outreach (cold-start prospecting): this is the daily friction of
 * 1:1 conversations. DMs, comments, mentions, follow-ups.
 *
 * Two model lanes:
 *   - voiced (Opus, default) — the polished reply you'd actually send
 *   - fast   (Haiku, opt-in)  — ~5x cheaper, for high-volume reply work
 *
 * Three drafts returned per call:
 *   - brief    : 1-3 sentences, just enough to acknowledge / advance
 *   - full     : 80-180 words, the substantive reply
 *   - redirect : 50-100 words, acknowledges then pivots to action
 *
 * Save path is intentionally absent — replies aren't strategic content
 * worth saving to Library. Copy → paste → send → done.
 */

const CHANNEL_OPTIONS = [
  { value: 'dm',       label: 'DM',           hint: 'LinkedIn / X / IG message' },
  { value: 'comment',  label: 'Public comment', hint: 'Visible to others' },
  { value: 'email',    label: 'Email',         hint: 'Salutation + sign-off appropriate' },
  { value: 'followup', label: 'Follow-up',     hint: 'After a prior conversation' },
];

const DRAFT_META = {
  brief:    { label: 'Brief',    description: '1–3 sentences. Acknowledges, advances. The default answer for most inbound.' },
  full:     { label: 'Full',     description: '80–180 words. The substantive reply when the inbound deserves engagement.' },
  redirect: { label: 'Redirect', description: '50–100 words. Acknowledges briefly, then pivots to a clear next step.' },
};

export default function ReplyAssistantView() {
  const [incoming, setIncoming] = useState('');
  const [sender, setSender] = useState('');
  const [situation, setSituation] = useState('');
  const [intent, setIntent] = useState('');
  const [channel, setChannel] = useState('dm');
  const [fast, setFast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [picked, setPicked] = useState(null);
  const [editedDraft, setEditedDraft] = useState('');
  const [copyNote, setCopyNote] = useState(null);

  async function submit() {
    if (incoming.trim().length < 10) {
      setError('Paste the inbound message (at least 10 characters).');
      return;
    }
    setError(null);
    setBusy(true);
    setDrafts(null);
    setPicked(null);
    setCopyNote(null);
    try {
      const r = await api.replyAssistant.draft({ incoming, sender, situation, intent, channel, fast });
      setDrafts(r.drafts);
    } catch (e) {
      setError(e.message || 'Drafting failed');
    } finally {
      setBusy(false);
    }
  }

  function pick(key) {
    setPicked(key);
    setEditedDraft(drafts?.[key] || '');
    setCopyNote(null);
  }

  async function copy() {
    const ok = await copyToClipboard(editedDraft);
    setCopyNote(ok ? 'Copied to clipboard.' : 'Copy failed — select and copy manually.');
  }

  function reset() {
    setDrafts(null);
    setPicked(null);
    setEditedDraft('');
    setCopyNote(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-text-secondary">Reply assistant</div>
        <h1 className="text-2xl font-semibold mt-1">Draft an in-voice reply</h1>
        <p className="text-text-secondary text-sm mt-2 max-w-3xl leading-relaxed">
          Paste an inbound DM, comment, or follow-up. The AI drafts three graded replies in your voice — brief, full, redirect-to-action. Copy the one that fits, send it, move on. Replies aren't saved here; this is daily-flow tooling, not strategic content.
        </p>
      </div>

      {!drafts && (
        <div className="space-y-4">
          <div className="card-pad space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-semibold">Inbound message</div>
              <VoiceCapture value={incoming} onChange={setIncoming} placeholderHint="dictate or paste" />
            </div>
            <textarea
              className="input min-h-[140px] text-sm"
              placeholder="Paste the DM / comment / email you received."
              value={incoming}
              onChange={(e) => setIncoming(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="card-pad space-y-3">
            <div className="text-sm font-semibold">Channel</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CHANNEL_OPTIONS.map((o) => {
                const active = channel === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setChannel(o.value)}
                    disabled={busy}
                    className={`text-left rounded-md border p-3 transition-colors ${
                      active
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border bg-[#161616] hover:border-text-secondary'
                    }`}
                  >
                    <div className="text-sm font-semibold">{o.label}</div>
                    <div className="text-[11px] text-text-secondary mt-0.5">{o.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card-pad space-y-2">
            <div className="text-sm font-semibold">Sender (optional)</div>
            <input
              className="input text-sm"
              placeholder="Their name + how you know them. Helps the AI calibrate familiarity."
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="card-pad space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-semibold">Context (optional)</div>
              <VoiceCapture value={situation} onChange={setSituation} />
            </div>
            <textarea
              className="input min-h-[80px] text-sm"
              placeholder="Prior conversations, relationship history, anything the AI should know to write a fitting reply."
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="card-pad space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-semibold">What do you want this reply to do?</div>
              <VoiceCapture value={intent} onChange={setIntent} />
            </div>
            <textarea
              className="input min-h-[60px] text-sm"
              placeholder='e.g. "Acknowledge but defer to next week" / "Open the door to a 15-min call" / "Politely close — not a fit right now"'
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="card-pad">
            <label className={`flex items-start gap-2 cursor-pointer ${fast ? 'text-primary' : 'text-text-secondary'}`}>
              <input
                type="checkbox"
                checked={fast}
                onChange={(e) => setFast(e.target.checked)}
                disabled={busy}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <div className="text-sm">⚡ Fast mode (Haiku, ~5x cheaper, slightly less polished)</div>
                <div className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                  Use for high-volume reply work where you'll polish manually anyway. Default Opus mode produces the cleanest in-voice output.
                </div>
              </div>
            </label>
          </div>

          {error && <div className="card-pad border-danger/40 bg-danger/5 text-sm text-danger">{error}</div>}

          <div className="flex justify-end">
            <button
              className="btn-primary"
              onClick={submit}
              disabled={busy || incoming.trim().length < 10}
            >
              {busy ? `Drafting (${fast ? 'Haiku' : 'Opus'})…` : 'Draft three replies →'}
            </button>
          </div>
        </div>
      )}

      {drafts && (
        <>
          <DraftPicker drafts={drafts} picked={picked} onPick={pick} />

          {picked && (
            <div className="card-pad space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm font-semibold">Editing: {DRAFT_META[picked]?.label}</div>
                  <div className="text-[11px] text-text-secondary mt-0.5">{DRAFT_META[picked]?.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <VoiceCapture value={editedDraft} onChange={setEditedDraft} />
                  <span className="text-[11px] text-text-secondary font-mono whitespace-nowrap">
                    {editedDraft.length} chars
                  </span>
                </div>
              </div>
              <textarea
                className="input min-h-[180px] text-sm"
                value={editedDraft}
                onChange={(e) => setEditedDraft(e.target.value)}
              />
              <div className="flex justify-end gap-2 flex-wrap">
                <button className="btn-ghost text-xs" onClick={() => setPicked(null)}>← Pick a different draft</button>
                <button className="btn-primary text-xs" onClick={copy}>Copy reply</button>
              </div>
              {copyNote && (
                <div className={`text-xs ${copyNote.includes('failed') ? 'text-warning' : 'text-success'}`}>{copyNote}</div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button className="btn-ghost text-xs" onClick={reset}>← Start a new reply</button>
          </div>
        </>
      )}
    </div>
  );
}

function DraftPicker({ drafts, picked, onPick }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">Three reply variants</div>
      <div className="text-[11px] text-text-secondary">All three are written in your voice. Pick the one that fits the moment, edit if needed, copy.</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {Object.entries(DRAFT_META).map(([key, meta]) => {
          const text = drafts[key] || '';
          const active = picked === key;
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
              <div className="text-xs text-text-primary mt-2 leading-relaxed line-clamp-[10] whitespace-pre-wrap">
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

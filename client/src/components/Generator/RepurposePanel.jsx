import { useState } from 'react';
import { api } from '../../lib/api.js';

// The derivative formats most useful for compounding a single post.
// Each target is a (type, platform) pair so the AI produces output shaped
// for the right surface.
const TARGETS = [
  { type: 'x-thread',            platform: 'X',           label: 'X thread',          emoji: '𝕏' },
  { type: 'x-standalone',        platform: 'X',           label: 'X post',            emoji: '𝕏' },
  { type: 'instagram-caption',   platform: 'Instagram',   label: 'IG caption',        emoji: '📸' },
  { type: 'carousel',            platform: 'LinkedIn',    label: 'Carousel',          emoji: '🖼️' },
  { type: 'video-hook-beats',    platform: 'TikTok',      label: 'Video script',      emoji: '🎬' },
  { type: 'article',             platform: 'newsletter',  label: 'Newsletter graf',   emoji: '📰' },
];

export default function RepurposePanel({ contentId, onRepurposed }) {
  const [busy, setBusy] = useState(null); // the `type` currently generating
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  async function runRepurpose(t) {
    setBusy(t.type);
    setError(null);
    try {
      const row = await api.library.repurpose(contentId, {
        target_type: t.type,
        target_platform: t.platform,
      });
      setResults((r) => [{ ...row, _targetLabel: t.label }, ...r]);
      if (onRepurposed) onRepurposed(row);
    } catch (err) {
      setError(err.message || 'Repurpose failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card-pad border-primary/30 bg-primary/5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-primary font-semibold text-sm">Repurpose this into…</div>
          <div className="text-text-secondary text-xs mt-1">
            A post you rated well is multi-use. One click turns it into derivatives for every channel, each reshaped for the format (not just translated).
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
        {TARGETS.map((t) => (
          <button
            key={t.type + t.platform}
            className="btn text-xs justify-center"
            onClick={() => runRepurpose(t)}
            disabled={Boolean(busy)}
            title={`Generate a ${t.label} version`}
          >
            {busy === t.type ? 'Generating…' : <>{t.emoji} {t.label}</>}
          </button>
        ))}
      </div>
      {error && <div className="text-danger text-xs mt-2">{error}</div>}
      {results.length > 0 && (
        <div className="mt-3 space-y-1 text-[11px] text-text-secondary">
          <div className="text-text-primary">Derivatives created (saved to Library):</div>
          {results.map((r) => (
            <div key={r.id} className="flex items-center justify-between">
              <span>✓ {r._targetLabel} — {r.title?.slice(0, 60)}</span>
              <a href="/library" className="underline hover:text-primary">view</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

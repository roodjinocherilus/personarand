import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';

/**
 * Voice Profile completeness card — Dashboard widget that surfaces the
 * structured-voice-document score. This is the single most important
 * health signal the user has: a thin profile means generic output, no
 * matter how good the rest of the system is.
 *
 * Two tiers:
 *   - Local heuristic score (always shown — instant)
 *   - AI-graded score (when present — overrides; shows the date it was scored)
 *
 * If the cold-start state is detected (everything empty), the card
 * collapses to a high-contrast onboarding banner instead of the
 * dimension breakdown — there's nothing to show until they start.
 */
export default function VoiceScoreCard() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let mounted = true;
    api.voiceProfile.get()
      .then((r) => { if (mounted) setState(r); })
      .catch(() => { if (mounted) setState({ error: true }); });
    return () => { mounted = false; };
  }, []);

  if (!state) return null;
  if (state.error) return null; // table missing → render nothing rather than scaring the user

  const { profile, local_score, cached_score } = state;
  const score = cached_score || local_score;
  const total = score?.total || 0;
  const breakdown = score?.breakdown || {};
  const isAiScored = !!cached_score;
  const isColdStart = !profile?.core_thesis && (!profile?.stand_for || profile.stand_for.length === 0);

  if (isColdStart) {
    return (
      <div className="card-pad border-warning/40 bg-warning/5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 max-w-3xl">
            <div className="font-semibold text-warning">⚠ Voice profile — not configured</div>
            <div className="text-text-secondary text-xs mt-1 leading-relaxed">
              Until your voice document is filled in, every generation reads the cold-start default voice. That's a generic operator voice — useful for first drafts but not yours. Three input modes: a structured questionnaire, a paste-into-your-existing-AI extraction, or a corpus paste where the system reads your past posts and proposes a draft.
            </div>
          </div>
          <Link
            to="/voice-profile"
            className="btn-primary text-xs whitespace-nowrap"
          >
            Build voice profile →
          </Link>
        </div>
      </div>
    );
  }

  // Tailwind JIT requires literal class names — no `text-${color}` interpolation.
  // Tier styles encoded as full class strings.
  const TIER_STYLES = {
    strong:      { container: 'border-success/40 bg-success/5', text: 'text-success', bar: 'bg-success', label: 'Strong',       note: 'The AI has a sharp, distinctive voice document to work from. Output should sound unmistakably yours.' },
    serviceable: { container: 'border-primary/40 bg-primary/5', text: 'text-primary', bar: 'bg-primary', label: 'Serviceable',  note: 'The AI has enough to ground generations. Filling weaker dimensions sharpens output further.' },
    thin:        { container: 'border-warning/40 bg-warning/5', text: 'text-warning', bar: 'bg-warning', label: 'Thin',         note: 'The voice document has gaps. Generations may drift toward generic operator voice on weaker dimensions.' },
    critical:    { container: 'border-danger/40 bg-danger/5',   text: 'text-danger',  bar: 'bg-danger',  label: 'Critical gap', note: 'Most dimensions are missing. The AI is mostly running on the default voice, not yours.' },
  };
  const DIM_STYLES = {
    success: { text: 'text-success', bar: 'bg-success' },
    primary: { text: 'text-primary', bar: 'bg-primary' },
    warning: { text: 'text-warning', bar: 'bg-warning' },
    danger:  { text: 'text-danger',  bar: 'bg-danger'  },
  };
  const tier = total >= 80 ? 'strong' : total >= 60 ? 'serviceable' : total >= 40 ? 'thin' : 'critical';
  const tierMeta = TIER_STYLES[tier];

  // Dimensions sorted weakest-first so the user sees what to work on next.
  const sortedDims = Object.entries(breakdown)
    .map(([key, b]) => ({ key, ...b }))
    .sort((a, b) => (a.weighted || 0) - (b.weighted || 0));

  return (
    <div className={`card-pad ${tierMeta.container}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className={`font-semibold ${tierMeta.text}`}>
            Voice profile — {total}% {isAiScored ? '(AI-graded)' : '(local heuristic)'}
          </div>
          <div className="text-text-secondary text-xs mt-1 max-w-3xl leading-relaxed">
            <span className={tierMeta.text}>{tierMeta.label}.</span> {tierMeta.note}
          </div>
        </div>
        <Link to="/voice-profile" className="btn-ghost text-xs whitespace-nowrap">
          Edit profile →
        </Link>
      </div>

      {/* Score bar */}
      <div className="mt-4">
        <div className="h-2 rounded-full bg-[#1f1f1f] overflow-hidden">
          <div
            className={`h-full ${tierMeta.bar} transition-all`}
            style={{ width: `${total}%` }}
          />
        </div>
      </div>

      {/* Top-3 weakest dimensions — what to work on next */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {sortedDims.slice(0, 3).map((d) => {
          const pct = d.weight ? Math.round(((d.weighted || 0) / d.weight) * 100) : 0;
          const colorKey = pct >= 80 ? 'success' : pct >= 50 ? 'primary' : pct >= 25 ? 'warning' : 'danger';
          const dimStyle = DIM_STYLES[colorKey];
          return (
            <div key={d.key} className="rounded-md border border-border bg-card p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className={`text-[11px] font-semibold ${dimStyle.text}`}>{d.label || d.key}</div>
                <div className="font-mono text-[11px] text-text-secondary">{pct}%</div>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-[#1f1f1f] overflow-hidden">
                <div className={`h-full ${dimStyle.bar}`} style={{ width: `${pct}%` }} />
              </div>
              {d.note && (
                <div className="text-[10px] text-text-secondary mt-1.5 leading-snug line-clamp-2">{d.note}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

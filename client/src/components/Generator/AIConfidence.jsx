import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

/**
 * Pre-generation confidence indicator — shows the user how much personalized
 * signal the AI has to work with BEFORE they click Generate. Two inputs feed
 * output quality: rated strong posts (tonal reference) and KB entries (situational
 * context). When both are empty, output is cold-start generic; this widget
 * makes that trade-off legible instead of surprising.
 */
export default function AIConfidence() {
  const [strongCount, setStrongCount] = useState(null);
  const [kbEntries, setKbEntries] = useState(null);

  useEffect(() => {
    api.library.topPerformers(10).then((r) => setStrongCount(r?.length ?? 0)).catch(() => setStrongCount(0));
    api.knowledge.list().then((r) => setKbEntries(r?.entries?.filter((e) => e.is_active).length ?? 0)).catch(() => setKbEntries(0));
  }, []);

  if (strongCount === null || kbEntries === null) return null;

  const coldStart = strongCount === 0 && kbEntries === 0;
  const sparse = !coldStart && (strongCount === 0 || kbEntries < 2);
  const healthy = !coldStart && !sparse;

  const toneCls = coldStart
    ? 'border-warning/40 bg-warning/5 text-warning'
    : sparse
    ? 'border-border bg-[#1a1a1a] text-text-secondary'
    : 'border-success/40 bg-success/5 text-success';

  return (
    <div className={`text-[11px] rounded-md border px-3 py-2 leading-relaxed ${toneCls}`}>
      {coldStart && (
        <>
          <strong>⚠ Cold start.</strong> AI has 0 rated posts and 0 Knowledge Base entries.
          Output will sound generic. Rate past posts with 🔥 and add KB entries for sharper results.
        </>
      )}
      {sparse && (
        <>
          <strong>Sparse signal.</strong> AI is referencing{' '}
          <strong>{strongCount}</strong> strong-rated post{strongCount === 1 ? '' : 's'} and{' '}
          <strong>{kbEntries}</strong> KB entr{kbEntries === 1 ? 'y' : 'ies'}. Adding more improves every future generation.
        </>
      )}
      {healthy && (
        <>
          ✓ AI is referencing <strong>{strongCount}</strong> strong-rated post{strongCount === 1 ? '' : 's'} and{' '}
          <strong>{kbEntries}</strong> KB entries. Output should match your voice.
        </>
      )}
    </div>
  );
}

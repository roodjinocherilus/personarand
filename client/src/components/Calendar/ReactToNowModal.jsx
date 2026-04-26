import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import ContentEditor from '../Generator/ContentEditor.jsx';

const FUNNEL_LAYERS = ['Discovery', 'Authority', 'Trust', 'Conversion', 'Identity'];
const PLATFORMS = ['LinkedIn', 'X', 'Instagram', 'Instagram Reels', 'TikTok', 'YouTube'];

/**
 * "⚡ React to now" — the reactive content flow.
 *
 * Two modes, both driven from the same source input:
 *   1. BRAINSTORM → get N angle ideas, each with suggested platform/format/funnel.
 *      From each angle: "Add to calendar" (creates a reactive calendar item
 *      in the chosen week) OR "Write full post now" (goes straight to the
 *      generator with this angle as the topic).
 *   2. WRITE DIRECTLY → skip angles, generate a full post immediately from
 *      the source + chosen format. For when you already know what you want
 *      to say. No calendar item created — lands in Library as a reactive
 *      content row.
 *
 * The source can be a URL, a headline, a thread excerpt, or just the user's
 * own observation in one or two sentences. Anything that captures "what am
 * I reacting to."
 */
export default function ReactToNowModal({ defaultWeek, onClose, onItemsAdded }) {
  const [source, setSource] = useState('');
  const [facts, setFacts] = useState('');
  const [platforms, setPlatforms] = useState(['LinkedIn', 'X']);
  const [count, setCount] = useState(4);
  const [targetWeek, setTargetWeek] = useState(defaultWeek || 1);
  const [step, setStep] = useState('input'); // 'input' | 'angles' | 'writing'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [angles, setAngles] = useState([]);
  const [savedMsg, setSavedMsg] = useState(null);
  const [writingAngle, setWritingAngle] = useState(null); // set when user clicks "Write full post"
  const [writing, setWriting] = useState(false);
  const [writtenRow, setWrittenRow] = useState(null);

  const sourceValid = source.trim().length >= 10;
  const modalRef = useRef(null);

  // When step changes, scroll the modal back to top so the user sees the
  // new state (loading indicator, angles list, written post) instead of
  // wondering where their click went because the new step rendered above
  // their scroll position.
  useEffect(() => {
    if (modalRef.current) {
      modalRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // Also log transitions so any future 'nothing happened' can be checked
    // directly in the browser devtools.
    // eslint-disable-next-line no-console
    console.log('[ReactToNow] step →', step, '| writing:', writing, '| loading:', loading);
  }, [step]);

  async function handleBrainstorm() {
    if (!sourceValid) {
      setError('Paste a URL, headline, or a sentence or two about what you\'re reacting to (at least ~10 characters).');
      return;
    }
    setLoading(true);
    setError(null);
    setAngles([]);
    try {
      const r = await api.calendar.reactiveAngles({
        source: source.trim(),
        count,
        platforms,
        facts: facts.trim() || undefined,
      });
      if (r.parse_error) {
        setError(`The AI didn\'t return parsable angles: ${r.parse_error}. Try rephrasing the source or giving more context.`);
        setStep('input');
        return;
      }
      if (!r.angles || r.angles.length === 0) {
        setError('No strong angles came back — the source might not have enough edge to warrant a reactive post, or the AI rejected all of them. Try a sharper source.');
        setStep('input');
        return;
      }
      setAngles(r.angles);
      setStep('angles');
    } catch (err) {
      setError(err.message || 'Failed to generate angles');
    } finally {
      setLoading(false);
    }
  }

  async function addToCalendar(angle) {
    try {
      await api.calendar.create({
        week: targetWeek,
        day: null,
        title: angle.title,
        description: angle.position || angle.why_it_works || '',
        content_type: angle.content_type || 'linkedin-short',
        platforms: Array.isArray(angle.platforms) ? angle.platforms : [],
        funnel_layer: angle.funnel_layer || 'Authority',
        status: 'planned',
        is_reactive: true,
        reactive_source: source.trim(),
      });
      setSavedMsg(`Added "${angle.title}" to Week ${targetWeek} as reactive.`);
      if (onItemsAdded) onItemsAdded();
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (err) {
      setError(`Couldn\'t add to calendar: ${err.message}`);
    }
  }

  async function writeFullPost(angleOrDirect) {
    // angleOrDirect === null → "skip angles, write one directly" flow.
    // Otherwise it's a specific angle returned by brainstorm.
    const isDirect = !angleOrDirect;
    // eslint-disable-next-line no-console
    console.log('[ReactToNow] writeFullPost:', isDirect ? 'skip-angles' : 'angle', '| source length:', source.trim().length, '| valid:', sourceValid);
    if (isDirect && !sourceValid) {
      setError(`Source is too short (${source.trim().length} characters). Paste a URL, a headline, or a sentence or two about what you're reacting to.`);
      return;
    }
    // Remember where we came from so failures return there instead of
    // dumping the user on an empty angles screen when they skipped angles.
    const returnStepOnError = isDirect ? 'input' : 'angles';
    setWriting(true);
    setWritingAngle(angleOrDirect || null);
    setStep('writing');
    setError(null);
    try {
      const angle = angleOrDirect || {};
      const payload = {
        type: angle.content_type || 'linkedin-short',
        platform: (angle.platforms && angle.platforms[0]) || 'LinkedIn',
        // In the angles path, topic = the angle's title + position. In the
        // skip-angles path, leave topic undefined so the backend's reactive
        // wrapper doesn't prepend a meaningless "Reactive commentary" string.
        topic: angle.title ? angle.title : undefined,
        tone: 'sharp',
        length: 'medium',
        funnel_layer: angle.funnel_layer || 'Authority',
        extra: [
          angle.position && `Specific position to take: ${angle.position}`,
          angle.evidence_basis && `Evidence grounding: ${angle.evidence_basis}`,
        ].filter(Boolean).join('\n\n') || undefined,
        // Crucial: DO NOT pass the raw source as title. Let the backend
        // derive a clean hook-based title from the generated body itself.
        // Passing source text produced garbage titles like the full source
        // string truncated to 80 chars.
        title: angle.title || undefined,
        reactive_source: source.trim(),
        reactive_facts: facts.trim() || undefined,
        reactive_counter_argument: angle.counter_argument || undefined,
        save: true,
      };
      // eslint-disable-next-line no-console
      console.log('[ReactToNow] firing generate.content with payload:', { type: payload.type, platform: payload.platform, has_reactive_source: !!payload.reactive_source, has_title: !!payload.title });
      const row = await api.generate.content(payload);
      // eslint-disable-next-line no-console
      console.log('[ReactToNow] generate.content returned row id:', row?.id, 'body length:', row?.body?.length);
      setWrittenRow(row);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ReactToNow] generate.content failed:', err);
      setError(err.message || 'Generation failed');
      setStep(returnStepOnError);
    } finally {
      setWriting(false);
    }
  }

  // Add the written post to a calendar slot. Only meaningful after the post
  // already exists in Library (writtenRow). Creates a reactive calendar item
  // with a reference to the content.
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  async function alsoAddToCalendar() {
    if (!writtenRow) return;
    setAdding(true);
    try {
      await api.calendar.create({
        week: targetWeek,
        day: null,
        title: writtenRow.title || source.trim().slice(0, 80),
        description: writingAngle?.position || writingAngle?.why_it_works || '',
        content_type: writtenRow.content_type || 'linkedin-short',
        platforms: writtenRow.platform ? [writtenRow.platform] : [],
        funnel_layer: writingAngle?.funnel_layer || 'Authority',
        status: 'scripted', // we already have content for it
        is_reactive: true,
        reactive_source: source.trim(),
      });
      setAdded(true);
      if (onItemsAdded) onItemsAdded();
    } catch (err) {
      setError(`Couldn't add to calendar: ${err.message}`);
    } finally {
      setAdding(false);
    }
  }

  function reset() {
    setStep('input');
    setAngles([]);
    setWrittenRow(null);
    setWritingAngle(null);
    setError(null);
    setSavedMsg(null);
  }

  return (
    <div ref={modalRef} className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8 overflow-y-auto bg-black/70">
      <div className="card w-full max-w-4xl my-4">
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-amber-400">⚡ Reactive content</div>
            <div className="text-lg font-semibold mt-1">
              {step === 'input' && 'What are you reacting to?'}
              {step === 'angles' && 'Pick an angle'}
              {step === 'writing' && (writing ? 'Writing reactive post…' : 'Reactive post ready')}
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose} disabled={writing}>✕</button>
        </div>

        {/* Source input stays visible across all steps for context */}
        <div className="px-6 pt-4 pb-3 border-b border-border/60 bg-[#0f0f0f] space-y-3">
          <div>
            <div className="label">Source — URL, headline, thread excerpt, or your own observation</div>
            <textarea
              className="input font-mono text-xs min-h-[80px]"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={`Examples:\n• https://techcrunch.com/2026/04/… (just paste the link)\n• "OpenAI launched a new agentic model today — it can..."\n• "Someone on X is claiming Haitian fintech can't scale because..."`}
              disabled={loading || writing}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="label !mb-0">Supporting data & facts (optional — but strongly recommended)</div>
              <span className="text-[10px] text-amber-400">⚡ reactive posts get scrutinized hardest</span>
            </div>
            <textarea
              className="input font-mono text-xs min-h-[60px] mt-1"
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              placeholder={`Numbers, dates, named examples, sources the AI should cite. Examples:\n• "Stripe reported $1.4T in volume in 2025; Shopify merchants averaged 43% YoY growth."\n• "Per Haiti Tech Summit 2026: 23 active media properties, 13 actif, only SPORO is Major."\n• "OpenAI's launch post dated April 21; Bloomberg confirmed $500M revenue run-rate."`}
              disabled={loading || writing}
            />
            <div className="text-[10px] text-text-secondary mt-1 leading-relaxed">
              The AI won't invent statistics. Paste the numbers, dates, and named examples you want cited so the post can be defended under criticism.
            </div>
          </div>
        </div>

        {step === 'input' && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="label">Target week (for calendar)</div>
                <input
                  type="number"
                  className="input font-mono"
                  value={targetWeek}
                  onChange={(e) => setTargetWeek(Number(e.target.value) || 1)}
                  min={1}
                />
              </div>
              <div>
                <div className="label">How many angles</div>
                <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  <option value={3}>3 angles</option>
                  <option value={4}>4 angles</option>
                  <option value={5}>5 angles</option>
                  <option value={7}>7 angles</option>
                </select>
              </div>
              <div>
                <div className="label">Platforms to bias toward</div>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])}
                      className={`pill text-[10px] ${platforms.includes(p) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}
                    >{p}</button>
                  ))}
                </div>
              </div>
            </div>

            {error && <div className="text-danger text-sm">{error}</div>}

            {/* Source-length hint visible inline instead of only showing up via disabled buttons.
                "Nothing happens when I click" is almost always a silent-disabled
                button — so we surface the reason proactively. */}
            {!sourceValid && source.length > 0 && (
              <div className="text-xs text-warning">
                Your source is {source.trim().length} character{source.trim().length === 1 ? '' : 's'}. Add a bit more context (at least ~10 characters) so the AI has something to work with.
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-border">
              <button
                className="btn"
                // Always clickable — writeFullPost handles validation and sets an explicit error.
                onClick={() => writeFullPost(null)}
                disabled={loading || writing}
                title="Skip angle-ideation and write a full post directly from the source"
              >
                {writing ? 'Writing…' : 'Skip angles — write one now'}
              </button>
              <button
                className="btn-primary"
                onClick={handleBrainstorm}
                disabled={loading || writing}
              >
                {loading ? 'Generating angles…' : `Generate ${count} angles`}
              </button>
            </div>
          </div>
        )}

        {step === 'angles' && (
          <div className="p-6 space-y-3">
            {error && <div className="text-danger text-sm">{error}</div>}
            {savedMsg && <div className="text-success text-sm">{savedMsg}</div>}
            <div className="text-[11px] text-text-secondary">
              {angles.length} angle{angles.length === 1 ? '' : 's'} generated · filtered through brand voice + doctrine. Save the ones that cut; discard the rest.
            </div>
            <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
              {angles.map((a, i) => (
                <AngleCard
                  key={i}
                  angle={a}
                  onAddToCalendar={() => addToCalendar(a)}
                  onWriteNow={() => writeFullPost(a)}
                />
              ))}
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-border">
              <button className="btn-ghost" onClick={reset}>← Change source</button>
              <button
                className="btn"
                onClick={() => writeFullPost(null)}
                disabled={writing}
                title="Write a post directly from the source, no angle"
              >
                Or write one directly
              </button>
            </div>
          </div>
        )}

        {step === 'writing' && (
          <div className="p-6 space-y-3">
            {writing && (
              <div className="card-pad text-text-secondary text-sm flex items-center justify-center min-h-[200px]">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 bg-amber-400 rounded-full animate-pulse" />
                  Writing reactive post {writingAngle ? `— "${writingAngle.title}"` : 'from source'}
                </div>
              </div>
            )}
            {writtenRow && (
              <>
                <div className="card-pad border-amber-500/30 bg-amber-500/5 flex items-start justify-between gap-3 flex-wrap">
                  <div className="text-sm text-amber-300">
                    ⚡ Reactive post saved to Library. Edit, refine, and publish same-day.
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-secondary">Target week:</span>
                    <input
                      type="number"
                      className="input font-mono w-16 py-1 text-xs"
                      value={targetWeek}
                      onChange={(e) => setTargetWeek(Number(e.target.value) || 1)}
                      min={1}
                      disabled={adding || added}
                    />
                    <button
                      className="btn text-xs"
                      onClick={alsoAddToCalendar}
                      disabled={adding || added}
                    >
                      {added ? '✓ In calendar' : adding ? 'Adding…' : 'Also add to calendar'}
                    </button>
                  </div>
                </div>
                <ContentEditor
                  initial={writtenRow}
                  platform={writtenRow.platform}
                  type={writtenRow.content_type}
                  onRegenerate={() => writingAngle ? writeFullPost(writingAngle) : writeFullPost(null)}
                  regenerating={writing}
                  onManualSave={onClose}
                />
              </>
            )}
            {error && <div className="text-danger text-sm">{error}</div>}
            <div className="flex justify-between items-center pt-3 border-t border-border">
              <button className="btn-ghost" onClick={() => setStep(angles.length ? 'angles' : 'input')} disabled={writing}>
                ← Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AngleCard({ angle, onAddToCalendar, onWriteNow }) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  async function handleAdd() {
    setAdding(true);
    try {
      await onAddToCalendar();
      setAdded(true);
    } finally {
      setAdding(false);
    }
  }
  return (
    <div className="card-pad border-amber-500/30 hover:border-amber-500/60 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider flex flex-wrap items-center gap-2">
            <span className="text-amber-400">⚡ reactive</span>
            <span>·</span>
            <span>{angle.content_type || 'linkedin-short'}</span>
            <span>·</span>
            <span>{angle.funnel_layer || 'Authority'}</span>
            {Array.isArray(angle.platforms) && angle.platforms.length > 0 && (
              <>
                <span>·</span>
                <span>{angle.platforms.join(', ')}</span>
              </>
            )}
          </div>
          <div className="text-base font-semibold mt-1.5">{angle.title}</div>
          {angle.position && (
            <div className="text-sm text-text-primary/90 mt-1.5 leading-snug">
              <span className="text-text-secondary text-xs">Position: </span>
              {angle.position}
            </div>
          )}
          {angle.evidence_basis && (
            <div className="text-[12px] mt-1.5 leading-snug text-emerald-300/90">
              <span className="text-emerald-400 font-semibold text-[11px] uppercase tracking-wider">Evidence · </span>
              {angle.evidence_basis}
            </div>
          )}
          {angle.counter_argument && (
            <div className="text-[12px] mt-1.5 leading-snug text-rose-300/90">
              <span className="text-rose-400 font-semibold text-[11px] uppercase tracking-wider">Counter · </span>
              {angle.counter_argument}
            </div>
          )}
          {angle.why_it_works && (
            <div className="text-[11px] text-text-secondary mt-1.5 leading-snug italic">
              {angle.why_it_works}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            className="btn text-xs"
            onClick={handleAdd}
            disabled={adding || added}
          >
            {added ? '✓ In calendar' : adding ? 'Adding…' : 'Add to calendar'}
          </button>
          <button
            className="btn-primary text-xs"
            onClick={onWriteNow}
          >
            Write full post →
          </button>
        </div>
      </div>
    </div>
  );
}


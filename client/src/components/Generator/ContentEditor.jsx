import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { RatingButtons } from '../Library/LibraryView.jsx';
import RepurposePanel from './RepurposePanel.jsx';
import PostedVersionPanel from './PostedVersionPanel.jsx';
import CaptionPanel from './CaptionPanel.jsx';
import RigorCheckPanel from './RigorCheckPanel.jsx';

// Content types that ship a MEDIA payload (video/script, slide deck) and
// therefore need a separate POST CAPTION for the text that sits above
// the media when published.
const NEEDS_CAPTION = new Set([
  'carousel',
  'video-hook-beats',
  'video-word-for-word',
  'youtube-essay',
]);

const STATUS_OPTIONS = ['draft', 'scheduled', 'posted', 'archived'];

const PLATFORM_HINT = {
  X: '280 chars per tweet',
  'Instagram Reels': 'Caption up to 2,200 chars; first 125 show before "more"',
  Instagram: 'Caption up to 2,200 chars',
  LinkedIn: 'Up to 3,000 chars; no cut-off before ~210',
  TikTok: 'Caption up to 2,200 chars',
  YouTube: 'Description up to 5,000 chars',
};

const AUTOSAVE_INTERVAL_MS = 30_000;

export default function ContentEditor({ initial, platform, type, onRegenerate, regenerating, onManualSave }) {
  const [body, setBody] = useState(initial.body || '');
  const [bodyFr, setBodyFr] = useState(initial.body_fr || '');
  const [title, setTitle] = useState(initial.title || '');
  const [titleFr, setTitleFr] = useState(initial.title_fr || '');
  const [status, setStatus] = useState(initial.status || 'draft');
  const [performance, setPerformance] = useState(initial.performance || null);
  // Track posted_version locally so the PostedVersionPanel updates without a full refetch.
  const [postedVersionEn, setPostedVersionEn] = useState(initial.posted_version_en || null);
  const [postedVersionFr, setPostedVersionFr] = useState(initial.posted_version_fr || null);
  // Which language the textarea is editing. Defaults to EN; if only FR exists
  // (unusual but possible), start on FR.
  const [lang, setLang] = useState(() => (!initial.body && initial.body_fr ? 'fr' : 'en'));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [autoSaveMsg, setAutoSaveMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [translatingFr, setTranslatingFr] = useState(false);
  const [id, setId] = useState(initial.id);
  // Refine-with-feedback iteration state.
  const [showRefine, setShowRefine] = useState(false);
  const [refineFeedback, setRefineFeedback] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState(null);
  const [refinementCount, setRefinementCount] = useState(0);

  // Last-persisted snapshot — used to detect dirty state for auto-save.
  const savedSnapshot = useRef({
    body: initial.body || '',
    body_fr: initial.body_fr || '',
    title: initial.title || '',
    title_fr: initial.title_fr || '',
    status: initial.status || 'draft',
  });
  // Latest values for the interval closure.
  const latest = useRef({ body, bodyFr, title, titleFr, status, id, saving });
  latest.current = { body, bodyFr, title, titleFr, status, id, saving };

  useEffect(() => {
    setBody(initial.body || '');
    setBodyFr(initial.body_fr || '');
    setTitle(initial.title || '');
    setTitleFr(initial.title_fr || '');
    setStatus(initial.status || 'draft');
    setPerformance(initial.performance || null);
    setPostedVersionEn(initial.posted_version_en || null);
    setPostedVersionFr(initial.posted_version_fr || null);
    setLang(!initial.body && initial.body_fr ? 'fr' : 'en');
    setId(initial.id);
    // Surface the existing refinement count if the row has been revised before.
    try {
      const meta = typeof initial.metadata === 'string' ? JSON.parse(initial.metadata) : initial.metadata;
      setRefinementCount(Array.isArray(meta?.refinements) ? meta.refinements.length : 0);
    } catch { setRefinementCount(0); }
    setSavedAt(null);
    setAutoSaveMsg(null);
    savedSnapshot.current = {
      body: initial.body || '',
      body_fr: initial.body_fr || '',
      title: initial.title || '',
      title_fr: initial.title_fr || '',
      status: initial.status || 'draft',
    };
  }, [initial.id]);

  async function handleRate(next) {
    const value = performance === next ? null : next;
    const prev = performance;
    setPerformance(value);
    try {
      await api.library.rate(id, value);
    } catch (err) {
      setPerformance(prev);
      alert(`Rating failed: ${err.message}`);
    }
  }

  // Current-language helpers — the textarea always edits whichever language is active.
  const currentBody = lang === 'fr' ? bodyFr : body;
  const currentTitle = lang === 'fr' ? titleFr : title;
  const setCurrentBody = lang === 'fr' ? setBodyFr : setBody;
  const setCurrentTitle = lang === 'fr' ? setTitleFr : setTitle;
  const hasFr = Boolean(bodyFr && bodyFr.length > 0);

  const words = currentBody.trim() ? currentBody.trim().split(/\s+/).length : 0;
  const chars = currentBody.length;

  async function persist({ auto = false } = {}) {
    const { body: b, bodyFr: bf, title: t, titleFr: tf, status: s, id: i, saving: currentlySaving } = latest.current;
    if (!i) return false;
    if (currentlySaving) return false;
    const snap = savedSnapshot.current;
    const dirty = b !== snap.body || bf !== snap.body_fr || t !== snap.title || tf !== snap.title_fr || s !== snap.status;
    if (!dirty) return false;

    setSaving(true);
    try {
      const updated = await api.library.update(i, {
        body: b,
        body_fr: bf || null,
        title: t,
        title_fr: tf || null,
        status: s,
      });
      savedSnapshot.current = {
        body: updated.body || '',
        body_fr: updated.body_fr || '',
        title: updated.title || '',
        title_fr: updated.title_fr || '',
        status: updated.status,
      };
      setBody(updated.body || '');
      setBodyFr(updated.body_fr || '');
      setTitle(updated.title || '');
      setTitleFr(updated.title_fr || '');
      setSavedAt(new Date());
      if (auto) {
        setAutoSaveMsg(`Auto-saved ${new Date().toLocaleTimeString()}`);
        setTimeout(() => setAutoSaveMsg(null), 3000);
      }
      return true;
    } catch (err) {
      if (!auto) alert(`Save failed: ${err.message}`);
      else setAutoSaveMsg(`Auto-save failed: ${err.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => { persist({ auto: true }); }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleBeforeUnload() {
      const { body: b, bodyFr: bf, title: t, titleFr: tf, status: s, id: i } = latest.current;
      const snap = savedSnapshot.current;
      const dirty = i && (b !== snap.body || bf !== snap.body_fr || t !== snap.title || tf !== snap.title_fr || s !== snap.status);
      if (!dirty) return;
      try {
        fetch(`/api/content/${i}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: b, body_fr: bf || null, title: t, title_fr: tf || null, status: s }),
          keepalive: true,
        });
      } catch { /* ignore */ }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  async function handleSave() {
    // Two cases:
    // 1. Dirty → persist, then close (firing onManualSave). If persist fails
    //    the error is surfaced; we do NOT close.
    // 2. Clean → there's nothing to save (content was already written on
    //    generation). Treat the click as "I'm done, close the window".
    const snap = savedSnapshot.current;
    const isDirty = body !== snap.body
      || bodyFr !== snap.body_fr
      || title !== snap.title
      || titleFr !== snap.title_fr
      || status !== snap.status;

    if (!isDirty) {
      if (onManualSave) onManualSave();
      return;
    }

    const ok = await persist({ auto: false });
    if (ok && onManualSave) onManualSave();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('Copy failed — select and copy manually');
    }
  }

  // Called when the rigor-check panel's "Apply fix" button is clicked on a
  // violation. Pipes the critic's suggested fix directly into the Refine flow
  // without requiring the user to retype it — closes the critic → refine loop.
  function applyFixFromCritic(fix) {
    if (!fix || !id) return;
    setShowRefine(true);
    setRefineFeedback(fix);
    setRefineError(null);
    // Scroll the Refine panel into view so the user sees what's happening.
    setTimeout(() => {
      const el = document.getElementById('refine-panel');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  // Refine the current-language body with specific user feedback. Replaces
  // the body in-place and syncs the savedSnapshot so dirty-state resets
  // (refinement is an AI action that's already persisted server-side — not
  // unsaved user edits).
  async function handleRefine() {
    if (!id || !refineFeedback.trim() || refineFeedback.trim().length < 3) {
      setRefineError('Give the AI at least a few words about what to change.');
      return;
    }
    setRefining(true);
    setRefineError(null);
    try {
      const r = await api.library.refine(id, {
        feedback: refineFeedback.trim(),
        language: lang,
      });
      // Replace the current-language body with the revised version.
      if (lang === 'fr') {
        setBodyFr(r.body);
        savedSnapshot.current = { ...savedSnapshot.current, body_fr: r.body };
      } else {
        setBody(r.body);
        savedSnapshot.current = { ...savedSnapshot.current, body: r.body };
      }
      setRefinementCount(r.revision_number || refinementCount + 1);
      setRefineFeedback(''); // clear for next round
      // Keep the panel open so the user can iterate multiple times without re-clicking.
    } catch (err) {
      setRefineError(err.message);
    } finally {
      setRefining(false);
    }
  }

  // Generate the French version on-demand for a row that only has English.
  async function handleTranslateFr() {
    if (!id || !body) return;
    setTranslatingFr(true);
    try {
      const result = await api.library.translateFr(id);
      setBodyFr(result.body_fr || '');
      setTitleFr(result.title_fr || '');
      savedSnapshot.current = {
        ...savedSnapshot.current,
        body_fr: result.body_fr || '',
        title_fr: result.title_fr || '',
      };
      setLang('fr');
    } catch (err) {
      alert(`French generation failed: ${err.message}`);
    } finally {
      setTranslatingFr(false);
    }
  }

  const dirty = (() => {
    const snap = savedSnapshot.current;
    return body !== snap.body
      || bodyFr !== snap.body_fr
      || title !== snap.title
      || titleFr !== snap.title_fr
      || status !== snap.status;
  })();

  // Post-status nudge: once content is marked posted AND it hasn't been rated
  // yet, surface a prominent prompt to rate it. Rating is what closes the
  // feedback loop — every unrated posted item is a missed teaching signal.
  const needsRating = status === 'posted' && !performance && id;

  return (
    <div className="card flex flex-col h-full">
      {/* Language tabs — only shown if French exists, or if we're generating it on-demand */}
      {(hasFr || translatingFr) && (
        <div className="px-4 pt-3 flex items-center gap-1 border-b border-border">
          <button
            onClick={() => setLang('en')}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
              lang === 'en'
                ? 'bg-[#1f1f1f] text-text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            🇬🇧 English
          </button>
          <button
            onClick={() => setLang('fr')}
            disabled={!hasFr && !translatingFr}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
              lang === 'fr'
                ? 'bg-[#1f1f1f] text-text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            🇫🇷 Français {translatingFr && <span className="ml-1 opacity-60">…</span>}
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <input
          className="bg-transparent outline-none text-sm font-medium flex-1 min-w-0"
          value={currentTitle}
          onChange={(e) => setCurrentTitle(e.target.value)}
          placeholder={lang === 'fr' ? 'Sans titre' : 'Untitled'}
        />
        <div className="flex items-center gap-2">
          {id && !hasFr && !translatingFr && (
            <button
              className="btn-ghost text-xs"
              onClick={handleTranslateFr}
              disabled={!body || translatingFr}
              title="Generate a French version of this post (uses Opus 4.7)"
            >
              🇫🇷 + French
            </button>
          )}
          {id && (
            <RatingButtons performance={performance} onRate={handleRate} />
          )}
          <select
            className="input py-1 text-xs w-32"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Rating nudge — appears when content is posted but unrated */}
      {needsRating && (
        <div className="px-4 py-2.5 border-b border-success/40 bg-success/10 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-success flex-1 min-w-0">
            <span className="font-semibold">This is now posted — how did it perform?</span>
            <span className="text-text-secondary ml-2">Rate to teach the AI what works. 🔥 feeds back into every new generation.</span>
          </div>
          <RatingButtons performance={performance} onRate={handleRate} />
        </div>
      )}

      <textarea
        className="flex-1 bg-[#0f0f0f] p-4 text-sm text-text-primary font-mono leading-relaxed outline-none min-h-[300px] resize-y"
        value={currentBody}
        onChange={(e) => setCurrentBody(e.target.value)}
        spellCheck
        placeholder={lang === 'fr' && !bodyFr && translatingFr ? 'Génération en français…' : ''}
      />

      <div className="px-4 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-[11px] text-text-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{words} words</span>
          <span>{chars} chars</span>
          {lang === 'fr' && <span className="text-primary">· French</span>}
          {PLATFORM_HINT[platform] && <span>· {PLATFORM_HINT[platform]}</span>}
          {autoSaveMsg && <span className="text-success">· {autoSaveMsg}</span>}
          {!autoSaveMsg && savedAt && <span className="text-success">· Saved {savedAt.toLocaleTimeString()}</span>}
          {!autoSaveMsg && !savedAt && id && dirty && <span>· Unsaved edits (auto-saves every 30s)</span>}
        </div>
        <div className="flex gap-2">
          {id && (
            <button
              className={`btn ${showRefine ? 'border-primary text-primary' : ''}`}
              onClick={() => setShowRefine((v) => !v)}
              title="Give the AI specific feedback and have it revise this in place"
            >
              ✎ Refine{refinementCount > 0 ? ` (${refinementCount})` : ''}
            </button>
          )}
          <button className="btn" onClick={onRegenerate} disabled={regenerating || saving}>
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
          <button className="btn" onClick={handleCopy}>
            {copied ? 'Copied' : `Copy ${lang.toUpperCase()}`}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : onManualSave ? (dirty ? 'Save & close' : 'Close') : (dirty ? 'Save' : 'Saved')}
          </button>
        </div>
      </div>

      {/* Refine-with-feedback panel — expands below the footer when toggled.
          The AI sees the current draft + user feedback and revises in place,
          keeping what works and only fixing what's called out. Iterate multiple
          times until it sits right. */}
      {showRefine && id && (
        <div id="refine-panel" className="p-4 border-t border-primary/40 bg-primary/5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm text-primary font-semibold">
              Refine this {lang === 'fr' ? 'French' : 'English'} draft
            </div>
            <button
              className="btn-ghost text-[11px]"
              onClick={() => { setShowRefine(false); setRefineFeedback(''); setRefineError(null); }}
            >
              Dismiss
            </button>
          </div>
          <div className="text-[11px] text-text-secondary leading-relaxed">
            Tell the AI specifically what to change. It keeps what works and only fixes what you call out — it does not start from scratch. Iterate as many times as needed.
          </div>
          <textarea
            className="input text-sm min-h-[80px]"
            value={refineFeedback}
            onChange={(e) => setRefineFeedback(e.target.value)}
            placeholder="e.g. shorter · lead with the counter-intuitive claim · drop the metaphor in paragraph 2 · more specific numbers · tone is too generic, sharpen · remove the Haiti reference"
            disabled={refining}
          />
          {refineError && <div className="text-danger text-xs">{refineError}</div>}
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-text-secondary">
              {refinementCount > 0 && <>Revised {refinementCount}× · </>}
              Uses Opus 4.7 with your feedback loop on.
            </div>
            <button
              className="btn-primary text-sm"
              onClick={handleRefine}
              disabled={refining || refineFeedback.trim().length < 3}
            >
              {refining ? 'Revising…' : 'Apply feedback & revise'}
            </button>
          </div>
        </div>
      )}

      {/* Rigor check — automatic critic pass. Auto-runs when the body
          changes substantively (generation, refine, edits). Surfaces any
          violations of the Evidentiary Rigor / Prose Discipline rules with
          concrete fixes. Each fix has an "Apply fix via Refine" button
          that pipes the suggestion straight into the Refine flow, closing
          the critic → refine loop. Only renders when there's a persisted
          id (the critic needs body to evaluate; no point on blank rows). */}
      {id && currentBody && currentBody.length >= 80 && (
        <div className="p-4 border-t border-border">
          <RigorCheckPanel
            body={currentBody}
            contentType={type || initial.content_type}
            platform={platform || initial.platform}
            language={lang}
            onApplyFix={applyFixFromCritic}
          />
        </div>
      )}

      {/* Caption panel — only for content types that have a MEDIA / caption
          split (videos and carousels). Text-only posts don't need it since
          the body IS the post. */}
      {id && NEEDS_CAPTION.has(type || initial.content_type) && (
        <div className="p-4 border-t border-border">
          <CaptionPanel
            contentId={id}
            initialCaptionEn={initial.caption_en}
            initialCaptionFr={initial.caption_fr}
            hasFrBody={Boolean(bodyFr)}
          />
        </div>
      )}

      {/* Posted-version capture — ask the user for the final version they
          actually posted. Only renders if posted_version not yet collected.
          Inside PostedVersionPanel itself it renders `null` when done. */}
      {status === 'posted' && id && !postedVersionEn && !postedVersionFr && (
        <PostedVersionPanel
          row={{ id, body, body_fr: bodyFr, posted_version_en: postedVersionEn, posted_version_fr: postedVersionFr }}
          onSaved={() => {
            // Optimistic update so the panel disappears without a refetch.
            setPostedVersionEn(body);
            setPostedVersionFr(bodyFr || null);
          }}
        />
      )}

      {/* Repurpose panel — only after the post is actually posted. The whole
          point is that a post you published (and ideally rated) is the seed
          for multi-channel derivatives. Don't clutter the editor during drafting. */}
      {status === 'posted' && id && (
        <div className="p-4 border-t border-border">
          <RepurposePanel contentId={id} />
        </div>
      )}
    </div>
  );
}

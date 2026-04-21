import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { RatingButtons } from '../Library/LibraryView.jsx';
import RepurposePanel from './RepurposePanel.jsx';
import PostedVersionPanel from './PostedVersionPanel.jsx';

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

export default function ContentEditor({ initial, platform, type, onRegenerate, regenerating }) {
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
    await persist({ auto: false });
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
          <button className="btn" onClick={onRegenerate} disabled={regenerating || saving}>
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
          <button className="btn" onClick={handleCopy}>
            {copied ? 'Copied' : `Copy ${lang.toUpperCase()}`}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

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

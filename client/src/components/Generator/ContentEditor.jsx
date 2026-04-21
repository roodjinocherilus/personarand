import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

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
  const [title, setTitle] = useState(initial.title || '');
  const [status, setStatus] = useState(initial.status || 'draft');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [autoSaveMsg, setAutoSaveMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [id, setId] = useState(initial.id);

  // Last-persisted snapshot — used to detect dirty state for auto-save.
  const savedSnapshot = useRef({
    body: initial.body || '',
    title: initial.title || '',
    status: initial.status || 'draft',
  });
  // Latest values captured for the interval closure to read without re-creating the interval.
  const latest = useRef({ body, title, status, id, saving });
  latest.current = { body, title, status, id, saving };

  useEffect(() => {
    setBody(initial.body || '');
    setTitle(initial.title || '');
    setStatus(initial.status || 'draft');
    setId(initial.id);
    setSavedAt(null);
    setAutoSaveMsg(null);
    savedSnapshot.current = {
      body: initial.body || '',
      title: initial.title || '',
      status: initial.status || 'draft',
    };
  }, [initial.id]);

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const chars = body.length;

  async function persist({ auto = false } = {}) {
    const { body: b, title: t, status: s, id: i, saving: currentlySaving } = latest.current;
    if (!i) return false;
    if (currentlySaving) return false;
    const snap = savedSnapshot.current;
    const dirty = b !== snap.body || t !== snap.title || s !== snap.status;
    if (!dirty) return false;

    setSaving(true);
    try {
      const updated = await api.library.update(i, { body: b, title: t, status: s });
      savedSnapshot.current = { body: updated.body, title: updated.title, status: updated.status };
      setBody(updated.body);
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

  // 30s auto-save, only if dirty and we have an id. Stable interval across edits.
  useEffect(() => {
    const timer = setInterval(() => { persist({ auto: true }); }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on tab close / unmount to avoid losing the last few keystrokes.
  useEffect(() => {
    function handleBeforeUnload() {
      const { body: b, title: t, status: s, id: i } = latest.current;
      const snap = savedSnapshot.current;
      const dirty = i && (b !== snap.body || t !== snap.title || s !== snap.status);
      if (!dirty) return;
      // Best-effort: keepalive fetch so the browser still sends it during unload.
      try {
        fetch(`/api/content/${i}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: b, title: t, status: s }),
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
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('Copy failed — select and copy manually');
    }
  }

  const dirty = (() => {
    const snap = savedSnapshot.current;
    return body !== snap.body || title !== snap.title || status !== snap.status;
  })();

  return (
    <div className="card flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <input
          className="bg-transparent outline-none text-sm font-medium flex-1 min-w-0"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
        />
        <div className="flex items-center gap-2">
          <select
            className="input py-1 text-xs w-32"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <textarea
        className="flex-1 bg-[#0f0f0f] p-4 text-sm text-text-primary font-mono leading-relaxed outline-none min-h-[300px] resize-y"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        spellCheck
      />

      <div className="px-4 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-[11px] text-text-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{words} words</span>
          <span>{chars} chars</span>
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
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

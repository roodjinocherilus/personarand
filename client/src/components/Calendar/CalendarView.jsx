import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import CalendarItem from './CalendarItem.jsx';
import GenerateModal from './GenerateModal.jsx';
import CalendarIntelligence from './CalendarIntelligence.jsx';
import DeepenPanel from './DeepenPanel.jsx';
import ReactToNowModal from './ReactToNowModal.jsx';

const PLATFORMS = ['LinkedIn', 'X', 'Instagram', 'Instagram Reels', 'TikTok', 'YouTube'];
const FUNNELS = ['Discovery', 'Authority', 'Trust', 'Conversion', 'Identity'];
const STATUSES = ['planned', 'scripted', 'shot', 'edited', 'posted'];

export default function CalendarView() {
  const [items, setItems] = useState([]);
  const [newsletters, setNewsletters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ platform: '', funnel_layer: '', status: '' });
  const [activeItem, setActiveItem] = useState(null);
  const [generateFor, setGenerateFor] = useState(null);
  const [showIntelligence, setShowIntelligence] = useState(null); // null | 'plan' | 'brainstorm' | 'gaps'
  const [deepenFor, setDeepenFor] = useState(null);
  const [showReactToNow, setShowReactToNow] = useState(false);
  const [reseeding, setReseeding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [cal, nl] = await Promise.all([
        api.calendar.list(),
        api.newsletter.list().catch(() => []),
      ]);
      setItems(cal || []);
      setNewsletters(nl || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const upcomingNewsletters = newsletters
    .filter((n) => n.status === 'scheduled' || n.status === 'draft')
    .sort((a, b) => (a.scheduled_send || a.updated_at).localeCompare(b.scheduled_send || b.updated_at));

  async function handleReseed() {
    if (!confirm(`Replace the current ${items.length} calendar items with the rich 30+ item default?\n\nGenerated content tied to calendar items will be detached (but kept in Library). This only affects the Calendar.`)) return;
    setReseeding(true);
    try {
      const r = await api.calendar.reseed(true);
      await load();
      alert(`Calendar re-seeded with ${r.items} items.`);
    } catch (err) { alert(err.message); }
    finally { setReseeding(false); }
  }

  async function handleClearAll() {
    if (!confirm(`Wipe ALL ${items.length} calendar items?\n\nThis does NOT delete generated content in your Library — only removes calendar entries. Anything derived from them stays.`)) return;
    setReseeding(true);
    try {
      const r = await api.calendar.clearAll();
      await load();
      alert(`Cleared ${r.deleted} calendar items.`);
    } catch (err) { alert(err.message); }
    finally { setReseeding(false); }
  }

  async function handleStatusChange(id, status) {
    try {
      await api.calendar.setStatus(id, status);
      // Reload the whole list so content_count/posted_count reflect any
      // server-side sync (e.g., calendar → 'posted' cascaded linked
      // generated_content rows to 'posted', bumping posted_count on this card).
      await load();
      if (activeItem && activeItem.id === id) {
        const fresh = await api.calendar.get(id);
        setActiveItem(fresh);
      }
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  }

  async function handleTitleSave(id, title) {
    // Inline title edits from the card — saves directly without opening the
    // drawer. Optimistically patches the item in local state so the card
    // doesn't flash, then fires-and-forgets a full reload in case anything
    // else changed on the server side.
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, title } : it)));
    if (activeItem && activeItem.id === id) {
      setActiveItem({ ...activeItem, title });
    }
    await api.calendar.update(id, { title });
  }

  const weeks = useMemo(() => {
    const filtered = items.filter((it) => {
      if (filters.platform && !(it.platforms || []).some((p) => p.includes(filters.platform))) return false;
      if (filters.funnel_layer && !(it.funnel_layer || '').toLowerCase().includes(filters.funnel_layer.toLowerCase())) return false;
      if (filters.status && it.status !== filters.status) return false;
      return true;
    });
    const byWeek = new Map();
    for (const it of filtered) {
      if (!byWeek.has(it.week)) byWeek.set(it.week, []);
      byWeek.get(it.week).push(it);
    }
    return [...byWeek.entries()].sort((a, b) => a[0] - b[0]);
  }, [items, filters]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Content Calendar</h1>
          <p className="text-text-secondary text-sm mt-1">
            Act 1: The bet is paying off. Act 2: This is what intelligence looks like. Act 3: You need to be inside this.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {items.length > 0 && (
            <button className="btn-ghost text-xs text-danger" onClick={handleClearAll} disabled={reseeding}>
              {reseeding ? '…' : `🗑 Clear all (${items.length})`}
            </button>
          )}
          <button
            className="btn border-amber-500/50 text-amber-400 hover:border-amber-500 hover:text-amber-300"
            onClick={() => setShowReactToNow(true)}
            title="React to news / trends / something happening now. Generates angles or a full post in your voice."
          >
            ⚡ React to now
          </button>
          <button className="btn" onClick={() => setShowIntelligence('gaps')}>📊 Gaps</button>
          <button className="btn" onClick={() => setShowIntelligence('brainstorm')}>💡 Brainstorm</button>
          <button className="btn-primary" onClick={() => setShowIntelligence('plan')}>✨ Plan weeks with AI</button>
        </div>
      </div>

      {items.length > 0 && items.length < 25 && (
        <div className="card-pad border-primary/40 bg-primary/5 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Upgrade to the rich default calendar?</div>
            <div className="text-xs text-text-secondary mt-1">
              You currently have <strong>{items.length}</strong> items. The new default seed has ~38 items across 4 weeks, matching funnel-layer targets, multi-platform, daily cadence. Or use ✨ Plan weeks with AI for per-week themed planning.
            </div>
          </div>
          <button className="btn-primary whitespace-nowrap" onClick={handleReseed} disabled={reseeding}>
            {reseeding ? 'Reseeding…' : 'Reseed calendar'}
          </button>
        </div>
      )}

      {upcomingNewsletters.length > 0 && (
        <div className="card-pad">
          <div className="section-title !mb-2">Newsletter — drafts and scheduled</div>
          <div className="space-y-1.5">
            {upcomingNewsletters.slice(0, 5).map((n) => (
              <div key={n.id} className="flex items-start justify-between text-sm border-b border-border pb-1.5 last:border-0">
                <div className="min-w-0">
                  <div className="truncate">{n.title || '(untitled)'}</div>
                  <div className="text-[11px] text-text-secondary">{n.template_type} · {n.subject_line || '(no subject)'}</div>
                </div>
                <div className="text-[11px] font-mono shrink-0 ml-3">
                  <span className={`pill ${n.status === 'scheduled' ? 'border-blue-500/40 text-blue-300 bg-blue-500/10' : 'border-border text-text-secondary'}`}>{n.status}</span>
                  {n.scheduled_send && <div className="text-text-secondary mt-1">{n.scheduled_send.slice(0, 10)}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-pad flex flex-wrap gap-4 items-end">
        <Field label="Platform">
          <select className="input" value={filters.platform} onChange={(e) => setFilters((f) => ({ ...f, platform: e.target.value }))}>
            <option value="">All</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Funnel layer">
          <select className="input" value={filters.funnel_layer} onChange={(e) => setFilters((f) => ({ ...f, funnel_layer: e.target.value }))}>
            <option value="">All</option>
            {FUNNELS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        {(filters.platform || filters.funnel_layer || filters.status) && (
          <button className="btn-ghost" onClick={() => setFilters({ platform: '', funnel_layer: '', status: '' })}>
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-text-secondary">Loading calendar…</div>
      ) : weeks.length === 0 ? (
        <div className="card-pad text-text-secondary">No items match current filters.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-5">
          {weeks.map(([week, weekItems]) => (
            <div key={week} className="space-y-3">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="text-sm font-semibold text-text-primary">Week {week}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost text-[11px]"
                    title="Copy this week's planned items into next week as fresh planned slots"
                    onClick={async () => {
                      const target = window.prompt(`Clone Week ${week}'s PLANNED items into which week number?`, String(week + 1));
                      if (target == null) return;
                      const toW = Number(target);
                      if (!Number.isInteger(toW) || toW < 1 || toW === week) {
                        alert('Pick a different week number.');
                        return;
                      }
                      try {
                        const r = await api.calendar.cloneWeek({ from_week: week, to_week: toW });
                        if (r.cloned === 0) {
                          alert(r.message || 'Nothing to clone.');
                        } else {
                          await load();
                        }
                      } catch (e) {
                        alert(`Clone failed: ${e.message}`);
                      }
                    }}
                  >
                    📋 Clone
                  </button>
                  <div className="text-[11px] text-text-secondary">{weekItems.length} items</div>
                </div>
              </div>
              {weekItems.map((item) => (
                <CalendarItem
                  key={item.id}
                  item={item}
                  onClick={() => setActiveItem(item)}
                  onStatusChange={(status) => handleStatusChange(item.id, status)}
                  onTitleSave={(title) => handleTitleSave(item.id, title)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {activeItem && (
        <DetailDrawer
          item={activeItem}
          onClose={() => setActiveItem(null)}
          onGenerate={() => setGenerateFor(activeItem)}
          onDeepen={() => setDeepenFor(activeItem)}
          onDelete={async () => {
            if (!confirm(`Delete "${activeItem.title}"?\n\nThis removes it from the calendar. Any generated content derived from it stays in Library.`)) return;
            try {
              await api.calendar.remove(activeItem.id);
              setActiveItem(null);
              await load();
            } catch (err) { alert(`Delete failed: ${err.message}`); }
          }}
          onStatusChange={(status) => handleStatusChange(activeItem.id, status)}
          onItemUpdated={async (updated) => {
            setActiveItem(updated);
            // Reload so the card in the main grid reflects edits too.
            await load();
          }}
        />
      )}

      {generateFor && (
        <GenerateModal
          item={generateFor}
          onClose={() => {
            setGenerateFor(null);
            // Reload calendar so the card reflects any status change and
            // updated content_count / posted_count after generation.
            load();
          }}
        />
      )}

      {showIntelligence && (
        <CalendarIntelligence
          initialTab={showIntelligence}
          onClose={() => setShowIntelligence(null)}
          onItemsAdded={() => load()}
        />
      )}

      {deepenFor && (
        <DeepenPanel
          item={deepenFor}
          onClose={() => setDeepenFor(null)}
        />
      )}

      {showReactToNow && (
        <ReactToNowModal
          // Default the target week to the highest week currently on the
          // calendar — reactive items naturally stack onto the latest planned
          // week. User can still edit in the modal.
          defaultWeek={items.length ? Math.max(...items.map((i) => Number(i.week) || 1)) : 1}
          onClose={() => { setShowReactToNow(false); load(); }}
          onItemsAdded={() => load()}
        />
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CONTENT_TYPES = [
  'linkedin-short', 'linkedin-long', 'x-thread', 'x-standalone',
  'instagram-caption', 'carousel',
  'video-hook-beats', 'video-word-for-word', 'youtube-essay',
  'article',
];
const FUNNEL_LAYERS = ['Discovery', 'Authority', 'Trust', 'Conversion', 'Identity'];
const ALL_PLATFORMS = ['LinkedIn', 'X', 'Instagram', 'Instagram Reels', 'TikTok', 'YouTube'];

function DetailDrawer({ item, onClose, onGenerate, onDeepen, onDelete, onStatusChange, onItemUpdated }) {
  const [mode, setMode] = useState('view'); // 'view' | 'edit' | 'refine'
  const [draft, setDraft] = useState({
    title: item.title || '',
    description: item.description || '',
    week: item.week || 1,
    day: item.day || '',
    content_type: item.content_type || 'linkedin-short',
    funnel_layer: item.funnel_layer || 'Discovery',
    platforms: Array.isArray(item.platforms) ? [...item.platforms] : [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Refine-brief state
  const [refineFeedback, setRefineFeedback] = useState('');
  const [refining, setRefining] = useState(false);

  // Re-seed draft when the active item changes (user clicks a different card).
  useEffect(() => {
    setDraft({
      title: item.title || '',
      description: item.description || '',
      week: item.week || 1,
      day: item.day || '',
      content_type: item.content_type || 'linkedin-short',
      funnel_layer: item.funnel_layer || 'Discovery',
      platforms: Array.isArray(item.platforms) ? [...item.platforms] : [],
    });
    setMode('view');
    setError(null);
    setRefineFeedback('');
  }, [item.id]);

  async function saveEdits() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.calendar.update(item.id, draft);
      setMode('view');
      if (onItemUpdated) onItemUpdated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRefineBrief() {
    if (!refineFeedback.trim() || refineFeedback.trim().length < 3) {
      setError('Tell the AI at least a few words about what to change.');
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const r = await api.calendar.refineBrief(item.id, { feedback: refineFeedback.trim() });
      const fresh = await api.calendar.get(item.id);
      setDraft((prev) => ({ ...prev, title: fresh.title, description: fresh.description }));
      setRefineFeedback('');
      if (onItemUpdated) onItemUpdated(fresh);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefining(false);
    }
  }

  function togglePlatform(p) {
    setDraft((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(p)
        ? prev.platforms.filter((x) => x !== p)
        : [...prev.platforms, p],
    }));
  }

  const isEditing = mode === 'edit';
  const isRefining = mode === 'refine';

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-xl bg-card border-l border-border p-6 overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-widest text-text-secondary">
              Week {isEditing ? draft.week : item.week}
              {(isEditing ? draft.day : item.day) ? ` · ${isEditing ? draft.day : item.day}` : ''}
            </div>
            {isEditing ? (
              <textarea
                className="input mt-2 text-xl font-semibold leading-tight"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                rows={2}
              />
            ) : (
              <h2 className="text-xl font-semibold mt-2 leading-tight">{item.title}</h2>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {mode === 'view' && (
              <>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setMode('refine')}
                  title="Give AI specific feedback to revise the brief"
                >
                  ✎ AI refine
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setMode('edit')}
                  title="Edit the direction, title, day, type, platforms manually"
                >
                  Edit
                </button>
              </>
            )}
            <button className="btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Brief / description */}
        {isEditing ? (
          <div className="mt-4">
            <div className="label">Brief / direction</div>
            <textarea
              className="input min-h-[140px]"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="1-3 sentences: the angle, the specific claim, the reader takeaway"
            />
          </div>
        ) : (
          <p className="text-text-secondary mt-4 leading-relaxed whitespace-pre-wrap">{item.description || '(no brief)'}</p>
        )}

        {/* Edit fields */}
        {isEditing && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <div className="label">Week #</div>
              <input
                type="number" min={1} max={52}
                className="input font-mono"
                value={draft.week}
                onChange={(e) => setDraft({ ...draft, week: Number(e.target.value) || 1 })}
              />
            </div>
            <div>
              <div className="label">Day</div>
              <select
                className="input"
                value={draft.day || ''}
                onChange={(e) => setDraft({ ...draft, day: e.target.value })}
              >
                <option value="">(none)</option>
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <div className="label">Content type</div>
              <select
                className="input"
                value={draft.content_type}
                onChange={(e) => setDraft({ ...draft, content_type: e.target.value })}
              >
                {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="label">Funnel layer</div>
              <select
                className="input"
                value={draft.funnel_layer}
                onChange={(e) => setDraft({ ...draft, funnel_layer: e.target.value })}
              >
                {FUNNEL_LAYERS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <div className="label">Platforms (click to toggle)</div>
              <div className="flex flex-wrap gap-2">
                {ALL_PLATFORMS.map((p) => {
                  const on = draft.platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`pill transition-colors ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:text-text-primary hover:border-[#555]'}`}
                      onClick={() => togglePlatform(p)}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* View-mode metadata */}
        {!isEditing && (
          <div className="grid grid-cols-2 gap-4 mt-6">
            <Meta label="Content type" value={item.content_type} />
            <Meta label="Funnel layer" value={item.funnel_layer} />
            <Meta label="Platforms" value={(item.platforms || []).join(', ')} />
            <Meta label="Status" value={item.status} />
          </div>
        )}

        {/* Refine-brief panel */}
        {isRefining && (
          <div className="mt-5 p-4 rounded-md border border-primary/40 bg-primary/5 space-y-2">
            <div className="flex items-start justify-between">
              <div className="text-sm text-primary font-semibold">Refine brief with AI</div>
              <button className="btn-ghost text-[11px]" onClick={() => { setMode('view'); setRefineFeedback(''); setError(null); }}>
                Dismiss
              </button>
            </div>
            <div className="text-[11px] text-text-secondary leading-relaxed">
              Tell the AI specifically how to change this day's direction. It keeps what works and only fixes what you call out. Don't worry — it won't overwrite content_type / funnel_layer / platforms, just title + brief.
            </div>
            <textarea
              className="input text-sm min-h-[80px]"
              value={refineFeedback}
              onChange={(e) => setRefineFeedback(e.target.value)}
              placeholder={`e.g. make this Haiti-specific · drop the "everyone's doing this" framing · pivot to a case-study angle · more counter-intuitive hook · shorter, sharper`}
              disabled={refining}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-text-secondary">Uses Opus 4.7 · feedback loop on.</div>
              <button
                className="btn-primary text-sm"
                onClick={handleRefineBrief}
                disabled={refining || refineFeedback.trim().length < 3}
              >
                {refining ? 'Revising…' : 'Apply feedback'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="text-danger text-xs mt-3">{error}</div>}

        {/* Edit save/cancel */}
        {isEditing && (
          <div className="flex justify-end gap-2 mt-5">
            <button className="btn" onClick={() => setMode('view')} disabled={saving}>Cancel</button>
            <button className="btn-primary" onClick={saveEdits} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}

        {/* Status controls (always visible) */}
        {!isEditing && (
          <div className="mt-6">
            <div className="label">Update status</div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  className={`pill transition-colors ${
                    item.status === s
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-secondary hover:text-text-primary hover:border-[#555]'
                  }`}
                  onClick={() => onStatusChange(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Primary actions */}
        {!isEditing && (
          <div className="grid grid-cols-1 gap-2 mt-8">
            <button className="btn" onClick={onDeepen}>🔍 Deepen this brief (outline + angles + counter-args)</button>
            <button className="btn-primary" onClick={onGenerate}>
              Generate content with Claude Opus 4.7 →
            </button>
            {onDelete && (
              <button className="btn-ghost text-danger text-xs mt-2" onClick={onDelete}>
                Delete this calendar item
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm">{value || '—'}</div>
    </div>
  );
}

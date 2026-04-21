import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import CalendarItem from './CalendarItem.jsx';
import GenerateModal from './GenerateModal.jsx';
import CalendarIntelligence from './CalendarIntelligence.jsx';
import DeepenPanel from './DeepenPanel.jsx';

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
      const updated = await api.calendar.setStatus(id, status);
      setItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
      if (activeItem && activeItem.id === id) setActiveItem(updated);
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
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
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold text-text-primary">Week {week}</div>
                <div className="text-[11px] text-text-secondary">{weekItems.length} items</div>
              </div>
              {weekItems.map((item) => (
                <CalendarItem
                  key={item.id}
                  item={item}
                  onClick={() => setActiveItem(item)}
                  onStatusChange={(status) => handleStatusChange(item.id, status)}
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

function DetailDrawer({ item, onClose, onGenerate, onDeepen, onDelete, onStatusChange }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-xl bg-card border-l border-border p-6 overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-text-secondary">Week {item.week} · {item.day}</div>
            <h2 className="text-xl font-semibold mt-2 leading-tight">{item.title}</h2>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="text-text-secondary mt-4 leading-relaxed">{item.description}</p>

        <div className="grid grid-cols-2 gap-4 mt-6">
          <Meta label="Content type" value={item.content_type} />
          <Meta label="Funnel layer" value={item.funnel_layer} />
          <Meta label="Platforms" value={(item.platforms || []).join(', ')} />
          <Meta label="Status" value={item.status} />
        </div>

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

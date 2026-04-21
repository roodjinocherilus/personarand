import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import ContentEditor from '../Generator/ContentEditor.jsx';
import GenerateModal from '../Calendar/GenerateModal.jsx';

const STATUSES = ['', 'draft', 'scheduled', 'posted', 'archived'];
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'unposted', label: 'Drafts first' },
  { value: 'best', label: 'Best-performing first' },
];
const PERFORMANCES = ['', 'strong', 'good', 'poor'];

export default function LibraryView() {
  const [rows, setRows] = useState([]);
  const [facets, setFacets] = useState({ platforms: [], content_types: [], funnel_layers: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ platform: '', status: '', content_type: '', funnel_layer: '', performance: '', q: '', sort: 'newest' });
  const [selected, setSelected] = useState(null);
  const [generateSeed, setGenerateSeed] = useState(null);
  const [strongCount, setStrongCount] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const result = await api.library.list(filters);
      setRows(result || []);
    } finally {
      setLoading(false);
    }
  }

  async function loadFacets() {
    try {
      const f = await api.library.facets();
      setFacets(f || { platforms: [], content_types: [], funnel_layers: [] });
    } catch { /* ignore */ }
  }

  useEffect(() => { loadFacets(); }, []);
  useEffect(() => { load(); }, [filters.platform, filters.status, filters.content_type, filters.funnel_layer, filters.performance, filters.sort]);
  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  // Count of "strong" posts — shown so the user knows how much tonal
  // reference the AI is working with.
  useEffect(() => {
    api.library.topPerformers(10)
      .then((r) => setStrongCount(r?.length ?? 0))
      .catch(() => setStrongCount(null));
  }, [rows]);

  async function handleRate(row, performance) {
    // Toggle off if clicking the current rating; otherwise set.
    const next = row.performance === performance ? null : performance;
    try {
      await api.library.rate(row.id, next);
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, performance: next } : r));
    } catch (err) {
      alert(`Rating failed: ${err.message}`);
    }
  }

  async function handleDelete(row) {
    const preview = (row.title || 'Untitled').slice(0, 60);
    if (!confirm(`Delete "${preview}"?\n\nThis removes the content from the Library. Any carousel design linked to it loses its back-reference but stays in the Carousel Studio. Cannot be undone.`)) return;
    try {
      await api.library.remove(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  function handleGenerateSimilar(row) {
    setGenerateSeed({
      type: row.content_type || 'linkedin-short',
      platform: row.platform || 'LinkedIn',
      topic: row.title,
      funnel_layer: row.calendar_funnel_layer,
      extra: `Tonal reference \u2014 the prior version started with: "${(row.body || '').slice(0, 200)}". Keep the same register and angle but vary the hook.`,
    });
  }

  const anyFilter = filters.platform || filters.status || filters.content_type || filters.funnel_layer || filters.performance || filters.q;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Content Library</h1>
          <p className="text-text-secondary text-sm mt-1">
            Every generation, saved. Rate posts as <span className="text-success">strong</span> to
            teach the AI what sounds like you — the top 5 get injected into every new generation as tonal reference.
          </p>
          {strongCount != null && strongCount > 0 && (
            <p className="text-[11px] text-primary mt-1">
              🔥 {strongCount} strong post{strongCount === 1 ? '' : 's'} actively feeding the AI
            </p>
          )}
          {strongCount === 0 && (
            <p className="text-[11px] text-text-secondary mt-1">
              No strong-rated posts yet. Rate your best work with 🔥 to start the feedback loop.
            </p>
          )}
        </div>
        <button
          className="btn"
          onClick={async () => {
            try { await api.library.export(); }
            catch (err) { alert(`Export failed: ${err.message}`); }
          }}
          title="Download the entire library as a single markdown file"
        >
          ⬇ Export as markdown
        </button>
      </div>

      <div className="card-pad flex flex-wrap gap-3 items-end">
        <Field label="Search" className="min-w-[200px] flex-1">
          <input
            className="input"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Title or body text"
          />
        </Field>
        <Field label="Platform">
          <select className="input" value={filters.platform} onChange={(e) => setFilters((f) => ({ ...f, platform: e.target.value }))}>
            <option value="">All</option>
            {facets.platforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className="input" value={filters.content_type} onChange={(e) => setFilters((f) => ({ ...f, content_type: e.target.value }))}>
            <option value="">All</option>
            {facets.content_types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Funnel">
          <select className="input" value={filters.funnel_layer} onChange={(e) => setFilters((f) => ({ ...f, funnel_layer: e.target.value }))}>
            <option value="">All</option>
            {['Discovery', 'Authority', 'Trust', 'Conversion', 'Identity'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
          </select>
        </Field>
        <Field label="Performance">
          <select className="input" value={filters.performance} onChange={(e) => setFilters((f) => ({ ...f, performance: e.target.value }))}>
            {PERFORMANCES.map((p) => <option key={p} value={p}>{p || 'Any'}</option>)}
          </select>
        </Field>
        <Field label="Sort">
          <select className="input" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {anyFilter && (
          <button className="btn-ghost" onClick={() => setFilters({ platform: '', status: '', content_type: '', funnel_layer: '', performance: '', q: '', sort: 'newest' })}>
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-text-secondary">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card-pad text-text-secondary">
          {anyFilter ? 'No content matches current filters.' : 'Library is empty. Generate something from the Calendar and it will land here.'}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-[11px] text-text-secondary">
            {rows.length} result{rows.length === 1 ? '' : 's'}
            {filters.q ? ` for "${filters.q}"` : ''}
          </div>
          {rows.map((row) => (
            <LibraryRow
              key={row.id}
              row={row}
              query={filters.q}
              onOpen={() => setSelected(row)}
              onGenerateSimilar={() => handleGenerateSimilar(row)}
              onRate={(p) => handleRate(row, p)}
              onDelete={() => handleDelete(row)}
            />
          ))}
        </div>
      )}

      {selected && (
        <SelectedModal row={selected} onClose={() => { setSelected(null); load(); }} />
      )}

      {generateSeed && (
        <GenerateModal
          seed={generateSeed}
          onClose={() => { setGenerateSeed(null); load(); }}
        />
      )}
    </div>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

function LibraryRow({ row, query, onOpen, onGenerateSimilar, onRate, onDelete }) {
  const excerpt = buildExcerpt(row.body || '', query, 180);
  return (
    <div className={`card-pad hover:border-[#555] transition-colors ${row.performance === 'strong' ? 'border-success/40 bg-success/5' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
          <div className="text-base font-semibold truncate">
            {query ? highlight(row.title || 'Untitled', query) : (row.title || 'Untitled')}
          </div>
          <div className="text-[11px] text-text-secondary mt-1 flex flex-wrap gap-2 items-center">
            <span>{row.platform || 'multi'}</span>
            <span>·</span>
            <span>{row.content_type}</span>
            {row.body_fr && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/40 bg-primary/5 text-primary text-[10px] font-medium">
                  EN · FR
                </span>
              </>
            )}
            {row.posted_version_en && row.posted_version_en !== row.body && (
              <>
                <span>·</span>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-success/40 bg-success/5 text-success text-[10px] font-medium"
                  title="You saved an edited version — the AI is learning from this"
                >
                  ✎ edited
                </span>
              </>
            )}
            {row.calendar_title && (<><span>·</span><span>Week {row.calendar_week}: {row.calendar_title}</span></>)}
            <span>·</span>
            <span>{new Date(row.created_at).toLocaleString()}</span>
          </div>
          <p className="text-sm text-text-secondary mt-3 line-clamp-2 whitespace-pre-wrap">
            {query ? highlight(excerpt, query) : excerpt}
          </p>
          {row.featured_in_newsletters && (
            <div className="text-[11px] text-primary mt-2">
              Featured in newsletter: {row.featured_in_newsletters}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`pill ${statusPill(row.status)}`}>{row.status}</span>
          <RatingButtons performance={row.performance} onRate={onRate} />
          <div className="flex gap-1">
            <button
              className="btn-ghost text-xs"
              onClick={(e) => { e.stopPropagation(); onGenerateSimilar(); }}
            >
              Generate similar
            </button>
            <button
              className="btn-ghost text-xs text-danger hover:!text-danger"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete this content row (cannot be undone)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 3-button rating control. Clicking the current rating toggles it off.
 * 👎 poor / 👌 good / 🔥 strong — strong posts feed back into the AI.
 * Exported so ContentEditor can reuse it inside the edit modal.
 */
export function RatingButtons({ performance, onRate, compact = false }) {
  const options = [
    { value: 'poor', icon: '👎', label: 'Poor', tint: 'text-danger' },
    { value: 'good', icon: '👌', label: 'Good', tint: 'text-text-secondary' },
    { value: 'strong', icon: '🔥', label: 'Strong — feeds AI', tint: 'text-success' },
  ];
  return (
    <div className={`flex items-center gap-1 ${compact ? '' : 'mt-0'}`} onClick={(e) => e.stopPropagation()}>
      {options.map((o) => {
        const active = performance === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onRate(o.value)}
            title={o.label + (active ? ' (click to clear)' : '')}
            className={`text-sm px-1.5 py-0.5 rounded border transition-all ${
              active
                ? 'border-border bg-[#2a2a2a] scale-110'
                : 'border-transparent opacity-40 hover:opacity-100 hover:bg-[#1f1f1f]'
            }`}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
}

function buildExcerpt(body, query, len) {
  if (!body) return '';
  if (!query) return body.slice(0, len) + (body.length > len ? '…' : '');
  const lower = body.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return body.slice(0, len) + (body.length > len ? '…' : '');
  // Center the excerpt around the match
  const start = Math.max(0, idx - Math.floor(len / 3));
  const end = Math.min(body.length, start + len);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  return prefix + body.slice(start, end) + suffix;
}

function highlight(text, query) {
  if (!query || !text) return text;
  const parts = String(text).split(new RegExp(`(${escapeRegex(query)})`, 'ig'));
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-primary/30 text-primary px-0.5 rounded-sm">{p}</mark>
      : <span key={i}>{p}</span>
  );
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function statusPill(status) {
  switch (status) {
    case 'draft': return 'border-border text-text-secondary';
    case 'scheduled': return 'border-blue-500/40 text-blue-300 bg-blue-500/10';
    case 'posted': return 'border-success/40 text-success bg-success/5';
    case 'archived': return 'border-border text-text-secondary opacity-60';
    default: return 'border-border text-text-secondary';
  }
}

function SelectedModal({ row, onClose }) {
  async function handleDelete() {
    const preview = (row.title || 'Untitled').slice(0, 60);
    if (!confirm(`Delete "${preview}"?\n\nThis removes the content from the Library. Cannot be undone.`)) return;
    try {
      await api.library.remove(row.id);
      onClose();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8 overflow-y-auto bg-black/70">
      <div className="card w-full max-w-4xl my-4">
        <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-text-secondary">
              {row.platform || 'multi'} · {row.content_type}
            </div>
            <div className="text-lg font-semibold mt-1 truncate">{row.title}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-ghost text-xs text-danger hover:!text-danger"
              onClick={handleDelete}
              title="Delete this content (cannot be undone)"
            >
              Delete
            </button>
            <button className="btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="p-6">
          <ContentEditor
            initial={row}
            platform={row.platform}
            type={row.content_type}
            onRegenerate={() => alert('Use Generate similar from the row list to regenerate with a different angle.')}
            regenerating={false}
          />
        </div>
      </div>
    </div>
  );
}

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
];

export default function LibraryView() {
  const [rows, setRows] = useState([]);
  const [facets, setFacets] = useState({ platforms: [], content_types: [], funnel_layers: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ platform: '', status: '', content_type: '', funnel_layer: '', q: '', sort: 'newest' });
  const [selected, setSelected] = useState(null);
  const [generateSeed, setGenerateSeed] = useState(null);

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
  useEffect(() => { load(); }, [filters.platform, filters.status, filters.content_type, filters.funnel_layer, filters.sort]);
  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  function handleGenerateSimilar(row) {
    setGenerateSeed({
      type: row.content_type || 'linkedin-short',
      platform: row.platform || 'LinkedIn',
      topic: row.title,
      funnel_layer: row.calendar_funnel_layer,
      extra: `Tonal reference \u2014 the prior version started with: "${(row.body || '').slice(0, 200)}". Keep the same register and angle but vary the hook.`,
    });
  }

  const anyFilter = filters.platform || filters.status || filters.content_type || filters.funnel_layer || filters.q;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Content Library</h1>
          <p className="text-text-secondary text-sm mt-1">
            Every generation, saved. The corpus is the institutional memory.
          </p>
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
        <Field label="Sort">
          <select className="input" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {anyFilter && (
          <button className="btn-ghost" onClick={() => setFilters({ platform: '', status: '', content_type: '', funnel_layer: '', q: '', sort: 'newest' })}>
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

function LibraryRow({ row, query, onOpen, onGenerateSimilar }) {
  const excerpt = buildExcerpt(row.body || '', query, 180);
  return (
    <div className="card-pad hover:border-[#555] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
          <div className="text-base font-semibold truncate">
            {query ? highlight(row.title || 'Untitled', query) : (row.title || 'Untitled')}
          </div>
          <div className="text-[11px] text-text-secondary mt-1 flex flex-wrap gap-2">
            <span>{row.platform || 'multi'}</span>
            <span>·</span>
            <span>{row.content_type}</span>
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
          <button
            className="btn-ghost text-xs"
            onClick={(e) => { e.stopPropagation(); onGenerateSimilar(); }}
          >
            Generate similar
          </button>
        </div>
      </div>
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
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8 overflow-y-auto bg-black/70">
      <div className="card w-full max-w-4xl my-4">
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-text-secondary">
              {row.platform || 'multi'} · {row.content_type}
            </div>
            <div className="text-lg font-semibold mt-1 truncate">{row.title}</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
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

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const FUNNEL_LAYERS = [
  { key: 'Discovery', target: 6, tint: 'bg-blue-500/10 border-blue-500/30 text-blue-300' },
  { key: 'Authority', target: 4, tint: 'bg-purple-500/10 border-purple-500/30 text-purple-300' },
  { key: 'Trust', target: 3, tint: 'bg-amber-500/10 border-amber-500/30 text-amber-300' },
  { key: 'Conversion', target: 2, tint: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' },
  { key: 'Identity', target: 2, tint: 'bg-rose-500/10 border-rose-500/30 text-rose-300' },
];

const PLATFORM_BASELINE = {
  Instagram: { followers: 4212, note: '~23K monthly reach' },
  Facebook: { followers: 6027, note: '~1 post/month' },
  LinkedIn: { followers: 3043, note: 'Impressions +187.5% when active' },
  TikTok: { followers: 2200, note: 'Declining, ~117 views/week' },
  X: { followers: 1200, note: 'Impressions +172%, engagement +266%' },
  YouTube: { followers: 730, note: 'Dormant, 15.9K lifetime views' },
};

export default function Dashboard() {
  const [calendar, setCalendar] = useState([]);
  const [library, setLibrary] = useState([]);
  const [latestMetrics, setLatestMetrics] = useState([]);
  const [platformHealth, setPlatformHealth] = useState({});
  const [outcomesSummary, setOutcomesSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [healthStatus, setHealthStatus] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const [alerts, setAlerts] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cal, lib, metrics, phealth, osummary, health, sc, al] = await Promise.all([
          api.calendar.list(),
          api.library.list(),
          api.metrics.latest(),
          api.metrics.health().catch(() => ({})),
          api.outcomes.summary().catch(() => ({})),
          api.health().catch(() => null),
          api.unified.scorecard().catch(() => null),
          api.unified.alerts().catch(() => null),
        ]);
        if (cancelled) return;
        setCalendar(cal || []);
        setLibrary(lib || []);
        setLatestMetrics(metrics || []);
        setPlatformHealth(phealth || {});
        setOutcomesSummary(osummary || {});
        setHealthStatus(health);
        setScorecard(sc);
        setAlerts(al);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const funnelCounts = FUNNEL_LAYERS.map((layer) => {
    const count = calendar.filter((item) =>
      (item.funnel_layer || '').toLowerCase().includes(layer.key.toLowerCase())
    ).length;
    return { ...layer, count };
  });

  const libraryByPlatform = library.reduce((acc, row) => {
    const p = row.platform || 'unknown';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  const thisMonthCount = library.filter((row) => {
    if (!row.created_at) return false;
    const d = new Date(row.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const postedCount = library.filter((row) => row.status === 'posted').length;

  // Unrated-but-posted from the last 7 days — these are missed teaching
  // signals for the AI feedback loop. Show a banner if any exist.
  const sevenDaysAgo = Date.now() - 7 * 86400_000;
  const unratedPosted = library.filter((r) => {
    if (r.status !== 'posted') return false;
    if (r.performance) return false;
    const t = r.updated_at || r.created_at;
    return t && new Date(t).getTime() > sevenDaysAgo;
  });

  // Days since last posted — per platform, for cadence discipline.
  // If the user has ever posted there but nothing in >5 days, surface it.
  const daysSinceByPlatform = Object.entries(platformHealth || {})
    .filter(([, h]) => h.status !== 'unknown' && typeof h.days_since_last_posted === 'number' && h.days_since_last_posted >= 5)
    .sort((a, b) => b[1].days_since_last_posted - a[1].days_since_last_posted);

  // Next-up queue — what the user should tackle next.
  //  1. Items still 'planned' (not yet generated / posted)
  //  2. Earliest week first, within week use funnel-gap priority
  //  3. Cap at 3 current-week + 3 overdue (prior weeks, still planned)
  const plannedItems = calendar.filter((c) => c.status === 'planned');
  const maxWeek = calendar.length > 0 ? Math.max(...calendar.map((c) => c.week || 1)) : 1;
  // Naive "current week" = whichever week has the most posted+scripted items.
  // Good enough without committing to a real date→week map.
  const activityByWeek = {};
  for (const c of calendar) {
    if (c.status !== 'planned') {
      activityByWeek[c.week] = (activityByWeek[c.week] || 0) + 1;
    }
  }
  const currentWeek = Object.keys(activityByWeek).length > 0
    ? Number(Object.entries(activityByWeek).sort((a, b) => b[1] - a[1])[0][0])
    : 1;
  const currentWeekQueue = plannedItems.filter((c) => c.week === currentWeek).slice(0, 3);
  const overdue = plannedItems.filter((c) => (c.week || maxWeek) < currentWeek).slice(0, 3);

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-text-secondary mb-2">Core positioning</div>
        <h1 className="text-2xl md:text-3xl font-semibold leading-tight tracking-tight">
          Modern power belongs to those who understand{' '}
          <span className="text-primary">attention</span>,{' '}
          <span className="text-primary">systems</span>,{' '}
          <span className="text-primary">leverage</span>, and{' '}
          <span className="text-primary">execution</span>.
        </h1>
        <p className="text-text-secondary mt-3 max-w-3xl">
          Roodjino Chérilus — Managing Director, Banj Media. The personal brand is the BD engine at a 4:1 ratio against
          the institutional page. Presence over frequency. Proof over promotion.
        </p>
      </div>

      {healthStatus && !healthStatus.anthropic_key && (
        <div className="card-pad border-warning/40 bg-warning/5 text-warning text-sm">
          ⚠ ANTHROPIC_API_KEY is not set in .env. Content generation will fail until you add it.
        </div>
      )}

      {/* Review-enforcement ribbon — unrated posted content from the last week.
          Rating closes the feedback loop; every unrated post is teaching signal
          left on the table. */}
      {unratedPosted.length > 0 && (
        <div className="card-pad border-success/40 bg-success/5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-success font-semibold">
                🔥 Rate {unratedPosted.length} posted item{unratedPosted.length === 1 ? '' : 's'} from this week
              </div>
              <div className="text-text-secondary text-xs mt-1 max-w-2xl">
                Rating them teaches the AI what works. Top-rated posts get injected into every new generation as tonal reference — the more you rate, the sharper the voice matches yours.
              </div>
            </div>
            <a href="/library?sort=newest&status=posted&performance=" className="btn-primary text-xs whitespace-nowrap">
              Rate in Library →
            </a>
          </div>
        </div>
      )}

      {/* Cadence discipline — surface gaps since last-posted-per-platform. */}
      {daysSinceByPlatform.length > 0 && (
        <div className="card-pad border-warning/40 bg-warning/5">
          <div className="text-warning font-semibold text-sm mb-2">Posting cadence — attention needed</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {daysSinceByPlatform.slice(0, 4).map(([platform, h]) => (
              <div key={platform} className="text-text-secondary">
                <strong className="text-text-primary">{platform}</strong> — {h.days_since_last_posted} days since last post
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next-up queue — the 1-3 things to work on right now. */}
      {(currentWeekQueue.length > 0 || overdue.length > 0) && (
        <section>
          <div className="section-title">Next up</div>
          <div className="space-y-2">
            {overdue.length > 0 && (
              <div className="card-pad border-danger/30 bg-danger/5">
                <div className="text-danger text-sm font-semibold mb-2">
                  {overdue.length} overdue {overdue.length === 1 ? 'item' : 'items'} from prior weeks — decide to ship or archive
                </div>
                <div className="space-y-1.5">
                  {overdue.map((c) => (
                    <a
                      key={c.id}
                      href="/calendar"
                      className="block text-sm text-text-secondary hover:text-text-primary"
                    >
                      <span className="text-[10px] uppercase tracking-widest mr-2 text-danger/70">W{c.week}</span>
                      {c.title}
                      <span className="text-[10px] text-text-secondary/70 ml-2">· {c.funnel_layer} · {(c.platforms || []).join(', ')}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {currentWeekQueue.length > 0 && (
              <div className="card-pad">
                <div className="text-text-primary text-sm font-semibold mb-2">
                  Week {currentWeek} — up next
                </div>
                <div className="space-y-1.5">
                  {currentWeekQueue.map((c) => (
                    <a
                      key={c.id}
                      href="/calendar"
                      className="block text-sm text-text-secondary hover:text-text-primary"
                    >
                      <span className="text-[10px] uppercase tracking-widest mr-2 text-primary">{c.day || 'any'}</span>
                      {c.title}
                      <span className="text-[10px] text-text-secondary/70 ml-2">· {c.funnel_layer} · {(c.platforms || []).join(', ')}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {alerts && (alerts.hot_subscribers_unlinked > 0 || alerts.prospects_need_followup > 0 || alerts.aging_proposals > 0 || alerts.active_insights > 0) && (
        <div className="card-pad border-primary/40 bg-primary/5">
          <div className="section-title !mb-2">Recommended actions</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {alerts.hot_subscribers_unlinked > 0 && <div>🔥 <strong>{alerts.hot_subscribers_unlinked}</strong> hot newsletter subscribers not yet in prospects</div>}
            {alerts.prospects_need_followup > 0 && <div>📧 <strong>{alerts.prospects_need_followup}</strong> prospects need follow-up (>5 days)</div>}
            {alerts.aging_proposals > 0 && <div>📅 <strong>{alerts.aging_proposals}</strong> proposals awaiting response (>7 days)</div>}
            {alerts.active_insights > 0 && <div>💡 <strong>{alerts.active_insights}</strong> insights waiting in Attribution view</div>}
          </div>
        </div>
      )}

      {scorecard && (
        <section>
          <div className="section-title">This week scorecard</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Content posted" value={scorecard.content_posted || 0} hint={`${scorecard.content_created || 0} created`} />
            <Stat label="Emails sent" value={scorecard.emails_sent || 0} hint="prospecting" />
            <Stat label="Meetings done" value={scorecard.meetings_completed || 0} />
            <Stat label="Deals closed" value={scorecard.deals_closed || 0} hint={scorecard.deals_value ? `$${Number(scorecard.deals_value).toLocaleString()}` : ''} />
            <Stat label="Newsletter sent" value={scorecard.newsletters_sent || 0} hint={scorecard.newsletter_avg_open ? `${scorecard.newsletter_avg_open}% open` : ''} />
            <Stat label="New subscribers" value={scorecard.new_subscribers || 0} />
            <Stat label="Proposals sent" value={scorecard.proposals_sent || 0} />
            <Stat label="Pipeline value" value={scorecard.pipeline_value ? `$${Number(scorecard.pipeline_value).toLocaleString()}` : '—'} />
          </div>
        </section>
      )}

      <section>
        <div className="section-title">Funnel layer coverage (planned across 30 days)</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {funnelCounts.map((layer) => (
            <div key={layer.key} className={`card-pad border ${layer.tint}`}>
              <div className="text-xs font-medium uppercase tracking-wider opacity-80">{layer.key}</div>
              <div className="flex items-baseline gap-2 mt-2">
                <div className="text-3xl font-semibold">{loading ? '…' : layer.count}</div>
                <div className="text-xs opacity-70">/ {layer.target} target</div>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-current opacity-70"
                  style={{ width: `${Math.min(100, (layer.count / layer.target) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Content items this month" value={loading ? '…' : thisMonthCount} hint="In the generation library" />
        <Stat label="Posted" value={loading ? '…' : postedCount} hint={`of ${library.length} total generated`} />
        <Stat label="Calendar items" value={loading ? '…' : calendar.length} hint={`across ${new Set(calendar.map((c) => c.week)).size} weeks`} />
      </section>

      <section>
        <div className="section-title">Platform health</div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Object.entries(PLATFORM_BASELINE).map(([platform, base]) => {
            const latest = latestMetrics.find((m) => m.platform === platform);
            const followers = latest?.followers ?? base.followers;
            const delta = latest && latest.followers != null ? latest.followers - base.followers : null;
            const libraryCount = libraryByPlatform[platform] || 0;
            const health = platformHealth[platform];
            return (
              <div key={platform} className="card-pad">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{platform}</div>
                  {health && <HealthPill status={health.status} />}
                </div>
                <div className="text-2xl font-semibold mt-2 font-mono">{followers.toLocaleString()}</div>
                <div className="text-[11px] text-text-secondary mt-1">{base.note}</div>
                {delta !== null && delta !== 0 && (
                  <div className={`text-[11px] mt-1 font-mono ${delta > 0 ? 'text-success' : 'text-danger'}`}>
                    {delta > 0 ? '+' : ''}{delta.toLocaleString()} since baseline
                  </div>
                )}
                <div className="flex items-center justify-between mt-2 text-[11px] text-text-secondary">
                  <span>
                    {health?.days_since_last_posted == null
                      ? 'No posts logged'
                      : `${health.days_since_last_posted}d since post`}
                  </span>
                  {libraryCount > 0 && (
                    <span className="text-primary">{libraryCount} drafted</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="section-title">Commercial outcomes</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Inbound inquiries"
            value={outcomesSummary.inquiry?.count ?? 0}
            hint="Total logged"
          />
          <Stat
            label="Speaking invites"
            value={outcomesSummary.speaking?.count ?? 0}
            hint="Total logged"
          />
          <Stat
            label="Warm intros"
            value={outcomesSummary.intro?.count ?? 0}
            hint="Total logged"
          />
          <Stat
            label="Attributed revenue"
            value={
              outcomesSummary.revenue?.total_value
                ? `$${Number(outcomesSummary.revenue.total_value).toLocaleString()}`
                : '—'
            }
            hint={`${outcomesSummary.revenue?.count || 0} entries`}
          />
        </div>
        <OutcomesLogger onSaved={async () => {
          const s = await api.outcomes.summary().catch(() => ({}));
          setOutcomesSummary(s || {});
        }} />
      </section>
    </div>
  );
}

function OutcomesLogger({ onSaved }) {
  const [type, setType] = useState('inquiry');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save() {
    if (!description.trim()) { setMsg('Description is required'); return; }
    setSaving(true);
    setMsg(null);
    try {
      await api.outcomes.create({
        outcome_type: type,
        description,
        value: value || null,
        source: source || null,
      });
      setDescription('');
      setValue('');
      setSource('');
      setMsg('Logged.');
      onSaved();
    } catch (err) {
      setMsg(`Failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-pad mt-3">
      <div className="text-[11px] uppercase tracking-wider text-text-secondary mb-3">Log an outcome</div>
      <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr_120px_1fr_auto] gap-2 items-start">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="inquiry">Inquiry</option>
          <option value="speaking">Speaking</option>
          <option value="intro">Warm intro</option>
          <option value="revenue">Revenue</option>
        </select>
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Who, what — e.g. 'Caribbean foundation exec reached out re: comms retainer'"
        />
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={type === 'revenue' ? '$ amount' : 'Value (opt)'}
          inputMode="numeric"
        />
        <input
          className="input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Source (post, platform)"
        />
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Logging…' : 'Log'}
        </button>
      </div>
      {msg && <div className="text-xs text-text-secondary mt-2">{msg}</div>}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="card-pad">
      <div className="text-[11px] uppercase tracking-wider text-text-secondary">{label}</div>
      <div className="text-2xl font-semibold mt-1 font-mono">{value}</div>
      {hint && <div className="text-[11px] text-text-secondary mt-1">{hint}</div>}
    </div>
  );
}

function HealthPill({ status }) {
  const map = {
    healthy: 'border-success/40 text-success bg-success/5',
    declining: 'border-warning/40 text-warning bg-warning/5',
    neglected: 'border-danger/40 text-danger bg-danger/5',
    unknown: 'border-border text-text-secondary',
  };
  const label = status === 'unknown' ? 'not tracked' : status;
  return <span className={`pill ${map[status] || map.unknown}`}>{label}</span>;
}

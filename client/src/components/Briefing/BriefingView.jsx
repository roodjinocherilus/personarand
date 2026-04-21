import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function nextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return fmt(d);
}

export default function BriefingView() {
  const [weekStart, setWeekStart] = useState(nextMonday());
  const [news, setNews] = useState('');
  const [goals, setGoals] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [runningState, setRunningState] = useState(null);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const list = await api.briefings.list();
      setHistory(list || []);
    } catch { /* silent */ }
    finally { setLoadingHistory(false); }
  }

  // Pre-populate news + goals from the most recent briefing. Your context
  // has continuity — you're tracking the same themes week over week, not
  // rebuilding from scratch each Monday.
  async function loadRunningState() {
    try {
      const s = await api.briefings.runningState();
      setRunningState(s);
      // Only pre-fill if the user hasn't typed anything yet this session.
      if (s.news_context && !news) setNews(s.news_context);
      if (s.goals_context && !goals) setGoals(s.goals_context);
    } catch { /* silent */ }
  }

  useEffect(() => {
    loadHistory();
    loadRunningState();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const r = await api.briefings.generate({
        week_start: weekStart,
        news_context: news.trim(),
        goals_context: goals.trim(),
      });
      if (r.parse_error) {
        setError(`AI output parse issue: ${r.parse_error}. Raw: ${(r.raw || '').slice(0, 300)}`);
      } else {
        setOutput(r.output);
        setState(r.state);
        loadHistory();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addAngleToCalendar(angle) {
    try {
      const week = Math.max(1, Math.ceil((new Date(weekStart) - new Date('2026-04-06')) / (7 * 86400 * 1000)) + 1);
      for (const idea of (angle.post_ideas || [])) {
        await api.calendar.create({
          week,
          day: null,
          title: idea.title || angle.title,
          description: `${angle.hook}\n\nBrand fit: ${angle.why_it_fits_your_brand}\n\nHook line: ${idea.hook}`,
          content_type: idea.content_type || 'linkedin-short',
          platforms: idea.platform ? [idea.platform] : [],
          funnel_layer: angle.funnel_layer || 'Authority',
        });
      }
      alert(`Added ${(angle.post_ideas || []).length} post ideas to the calendar (week ${week}).`);
    } catch (err) {
      alert(`Failed to add: ${err.message}`);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Weekly Briefing</h1>
        <p className="text-text-secondary text-sm mt-1 max-w-3xl">
          Tell the AI what you&apos;re watching in the world and what you want to lean into. It reads your calendar state,
          recent posts, last review, and metrics — then proposes 3-5 angles for the week that tie external events to
          your brand thesis and fill coverage gaps.
        </p>
      </div>

      {runningState && runningState.recurring_themes && runningState.recurring_themes.length > 0 && (
        <div className="card-pad border-primary/30 bg-primary/5">
          <div className="text-primary text-sm font-semibold">Recurring themes across your last {runningState.briefing_count} briefings</div>
          <div className="text-text-secondary text-xs mt-1 max-w-2xl">
            These words keep showing up in your angles. If any of them represent a core thesis, consider a flagship carousel or essay that owns it.
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {runningState.recurring_themes.map((t) => (
              <span key={t.word} className="pill border-primary/40 bg-primary/10 text-primary text-[11px]">
                {t.word} <span className="text-text-secondary ml-1">×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {runningState && runningState.last_week && (news || goals) && (
        <div className="text-[11px] text-text-secondary">
          Pre-filled from your briefing dated {runningState.last_week}. Edit as needed.
        </div>
      )}

      <div className="card-pad space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 items-end">
          <div>
            <div className="label">Week starting</div>
            <input
              type="date"
              className="input"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
            />
          </div>
          <div className="text-[11px] text-text-secondary">
            Pick the Monday of the week you&apos;re planning. The AI uses your current state as of today.
          </div>
        </div>

        <div>
          <div className="label">News / current events you&apos;re watching</div>
          <textarea
            className="input min-h-[90px]"
            value={news}
            onChange={(e) => setNews(e.target.value)}
            placeholder={`Paste 2-5 headlines you're tracking. Examples:\n- Haiti tech ecosystem summit this week\n- OpenAI announced their new agentic model\n- Caribbean fintech roundup published`}
          />
          <div className="text-[11px] text-text-secondary mt-1">
            Specific headlines give sharper angles than &ldquo;stuff&rdquo;. Include Haiti-specific items when relevant.
          </div>
        </div>

        <div>
          <div className="label">Your goals / what you want to lean into this week</div>
          <textarea
            className="input min-h-[70px]"
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder="e.g. Push the communication-infrastructure positioning harder. Start seeding the Banj Media case studies angle."
          />
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" onClick={run} disabled={busy}>
            {busy ? 'Thinking…' : 'Generate briefing'}
          </button>
        </div>

        {error && <div className="text-danger text-xs leading-relaxed">{error}</div>}
      </div>

      {output && (
        <div className="space-y-4">
          <div className="card-pad border-primary/40 bg-primary/5">
            <div className="text-[11px] uppercase tracking-widest text-primary">This week&apos;s theme</div>
            <div className="text-lg font-semibold mt-1">{output.headline}</div>
          </div>

          <div className="space-y-3">
            <div className="section-title">Suggested angles</div>
            {output.angles?.map((angle, i) => (
              <AngleCard key={i} angle={angle} onAdd={() => addAngleToCalendar(angle)} />
            ))}
          </div>

          {output.skip_this_week && (
            <div className="card-pad border-warning/40 bg-warning/5">
              <div className="section-title !mb-1 text-warning">Skip this week</div>
              <div className="text-sm">{output.skip_this_week}</div>
            </div>
          )}

          {state && <StateSummary state={state} />}
        </div>
      )}

      {!loadingHistory && history.length > 0 && (
        <div className="space-y-3 pt-6 border-t border-border">
          <div className="section-title">Past briefings</div>
          <div className="space-y-2">
            {history.map((b) => (
              <div key={b.id} className="card-pad flex items-start justify-between">
                <div>
                  <div className="text-[11px] text-text-secondary font-mono">Week of {b.week_start?.toString().slice(0, 10)}</div>
                  <div className="text-sm font-medium mt-0.5">{b.output?.headline || '(no headline)'}</div>
                  <div className="text-[11px] text-text-secondary mt-0.5">{b.output?.angles?.length || 0} angles</div>
                </div>
                <div className="text-[11px] text-text-secondary shrink-0">{new Date(b.created_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AngleCard({ angle, onAdd }) {
  return (
    <div className="card-pad space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">{angle.funnel_layer}</div>
          <div className="text-base font-semibold mt-1">{angle.title}</div>
        </div>
        <button className="btn-primary text-xs shrink-0" onClick={onAdd}>Add to calendar →</button>
      </div>

      <div className="text-sm text-text-primary leading-relaxed">
        <span className="text-primary">Hook:</span> {angle.hook}
      </div>

      <div className="text-sm text-text-secondary leading-relaxed">
        <span className="text-text-primary">Why it fits you:</span> {angle.why_it_fits_your_brand}
      </div>

      {angle.addresses_gap && (
        <div className="text-[11px] text-text-secondary">
          <span className="text-success">Fills gap:</span> {angle.addresses_gap}
        </div>
      )}

      {angle.post_ideas?.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-text-secondary">Post ideas</div>
          {angle.post_ideas.map((p, i) => (
            <div key={i} className="text-xs">
              <div className="flex gap-2 items-center">
                <span className="pill border-border text-text-secondary text-[10px]">{p.platform}</span>
                <span className="pill border-border text-text-secondary text-[10px]">{p.content_type}</span>
                <span className="font-medium">{p.title}</span>
              </div>
              {p.hook && <div className="text-text-secondary mt-0.5 pl-0.5">{p.hook}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StateSummary({ state }) {
  return (
    <details className="card-pad">
      <summary className="cursor-pointer text-sm font-medium">What the AI saw (context used)</summary>
      <div className="mt-3 space-y-3 text-xs">
        {state.funnel_gaps?.length > 0 && (
          <div>
            <div className="text-text-secondary uppercase tracking-wider text-[10px]">Funnel gaps the AI considered</div>
            {state.funnel_gaps.map((g) => (
              <div key={g.layer}>• {g.layer}: {g.planned}/{g.target} planned (need {g.short_by} more)</div>
            ))}
          </div>
        )}
        {state.neglected_platforms?.length > 0 && (
          <div>
            <div className="text-text-secondary uppercase tracking-wider text-[10px]">Neglected platforms</div>
            <div>{state.neglected_platforms.join(', ')}</div>
          </div>
        )}
        {state.recent_posted?.length > 0 && (
          <div>
            <div className="text-text-secondary uppercase tracking-wider text-[10px]">Recent posts the AI knew about</div>
            <div className="space-y-0.5">
              {state.recent_posted.slice(0, 5).map((p, i) => <div key={i}>• {p.title} ({p.platform})</div>)}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

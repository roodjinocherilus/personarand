const express = require('express');
const { openDb } = require('../db');
const { generate } = require('../lib/anthropic');

const router = express.Router();

const FUNNEL_TARGETS_WEEKLY = { Discovery: 6, Authority: 4, Trust: 3, Conversion: 2, Identity: 2 };
const PLATFORMS = ['LinkedIn', 'X', 'Instagram', 'Instagram Reels', 'TikTok', 'YouTube'];

router.get('/', async (req, res, next) => {
  try {
    const db = openDb();
    const rows = await db.prepare(`SELECT id, week_start, created_at, output FROM weekly_briefings ORDER BY week_start DESC LIMIT 50`).all();
    res.json(rows.map((r) => ({ ...r, output: normalizeObj(r.output) })));
  } catch (e) { next(e); }
});

/**
 * GET /api/briefings/running-state
 * Returns the most recent briefing's news_context + goals_context so the
 * UI can pre-populate those fields. Your news + goals have continuity —
 * you're tracking the same 3-5 themes for months, not starting blank each week.
 * Also returns recurring themes across the last 6 briefings so the AI can
 * detect patterns and the UI can surface "you've briefed on X for 4 weeks
 * running — worth a flagship piece?"
 */
router.get('/running-state', async (req, res, next) => {
  try {
    const db = openDb();
    const recent = await db.prepare(`
      SELECT week_start, news_context, goals_context, output
      FROM weekly_briefings
      ORDER BY week_start DESC
      LIMIT 6
    `).all();

    if (recent.length === 0) {
      return res.json({ news_context: '', goals_context: '', recurring_themes: [] });
    }

    const [latest] = recent;

    // Recurring theme detection — pull angle titles across briefings, find
    // words/phrases that appear repeatedly. Rough but useful.
    const allTitles = [];
    for (const r of recent) {
      const out = normalizeObj(r.output);
      for (const a of out?.angles || []) {
        if (a?.title) allTitles.push(a.title);
      }
    }
    const wordCounts = {};
    const stop = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'is', 'are', 'in', 'on', 'for', 'to', 'your', 'you', 'with', 'from', 'at', 'as', 'how', 'why', 'what', 'this', 'that']);
    for (const title of allTitles) {
      const words = title.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) || [];
      for (const w of words) {
        if (!stop.has(w)) wordCounts[w] = (wordCounts[w] || 0) + 1;
      }
    }
    const recurring = Object.entries(wordCounts)
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word, count]) => ({ word, count }));

    res.json({
      news_context: latest.news_context || '',
      goals_context: latest.goals_context || '',
      last_week: latest.week_start,
      briefing_count: recent.length,
      recurring_themes: recurring,
    });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const row = await db.prepare(`SELECT * FROM weekly_briefings WHERE id = ?`).get([req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ ...row, output: normalizeObj(row.output), usage: normalizeObj(row.usage) });
  } catch (e) { next(e); }
});

// Gather current state + call Opus with a briefing prompt
router.post('/generate', async (req, res, next) => {
  try {
    const db = openDb();
    const { week_start, news_context = '', goals_context = '' } = req.body || {};
    if (!week_start) return res.status(400).json({ error: 'week_start required (YYYY-MM-DD)' });

    // Gather current user state
    const state = await gatherState(db, week_start);

    const topic = buildPrompt(state, news_context, goals_context, week_start);

    const extra = `Return ONLY a JSON object with this exact shape:
{
  "headline": "one line on the theme of this week (10-15 words)",
  "angles": [
    {
      "title": "short 5-10 word title",
      "hook": "one sentence external hook or observation — what's happening right now that makes this timely",
      "why_it_fits_your_brand": "one sentence on why this lands for Roodjino specifically (strategy, expertise, Haiti perspective)",
      "funnel_layer": "Discovery" | "Authority" | "Trust" | "Conversion" | "Identity",
      "addresses_gap": "which of the user's current gaps this fills (funnel coverage, platform neglect, narrative continuity)",
      "post_ideas": [
        { "content_type": "linkedin-long" | "linkedin-short" | "x-thread" | "x-standalone" | "instagram-caption" | "carousel" | "video-clip", "platform": "LinkedIn" | "X" | "Instagram" | "TikTok" | "YouTube", "title": "working title", "hook": "opening line" }
      ]
    }
  ],
  "skip_this_week": "one-line advice on what NOT to post this week (if anything — return empty string if nothing to skip)"
}

Generate 3-5 angles. Each angle must have 2-3 post_ideas. No code fences. No commentary. Just the JSON.`;

    // Briefing angles should reflect what's actually performed — inject top-rated posts.
    const result = await generate({
      type: 'article',
      platform: 'briefing',
      topic,
      tone: 'sharp',
      length: 'medium',
      extra,
      useFeedbackLoop: true,
    });

    const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.json({ parse_error: 'Could not parse JSON output from AI', raw: result.text, state });
    }

    // Save
    const info = await db.prepare(`
      INSERT INTO weekly_briefings (week_start, news_context, goals_context, output, usage)
      VALUES (?, ?, ?, ?::jsonb, ?::jsonb)
    `).run([
      week_start, news_context, goals_context,
      JSON.stringify(parsed), JSON.stringify(result.usage || {}),
    ]);

    const row = await db.prepare(`SELECT * FROM weekly_briefings WHERE id = ?`).get([info.lastInsertRowid]);
    res.json({
      ...row,
      output: normalizeObj(row.output),
      usage: normalizeObj(row.usage),
      state,
    });
  } catch (err) { console.error('[briefings/generate]', err); next(err); }
});

async function gatherState(db, weekStart) {
  const weekEnd = addDays(weekStart, 7);
  const priorWeekStart = addDays(weekStart, -7);

  // Recent posted content (last 14 days)
  const recentPosted = await db.prepare(`
    SELECT gc.title, gc.content_type, gc.platform, gc.updated_at, cc.funnel_layer
    FROM generated_content gc
    LEFT JOIN content_calendar cc ON cc.id = gc.calendar_id
    WHERE gc.status = 'posted' AND gc.updated_at >= NOW() - INTERVAL '14 days'
    ORDER BY gc.updated_at DESC
    LIMIT 20
  `).all();

  // Upcoming planned content (next 7 days worth of calendar items with status=planned)
  const upcomingPlanned = await db.prepare(`
    SELECT title, content_type, platforms, funnel_layer, week, day
    FROM content_calendar
    WHERE status = 'planned'
    ORDER BY week ASC, id ASC
    LIMIT 30
  `).all();

  // Funnel coverage for this week's upcoming content
  const funnelCounts = Object.fromEntries(Object.keys(FUNNEL_TARGETS_WEEKLY).map((k) => [k, 0]));
  const platformCounts = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
  for (const it of upcomingPlanned) {
    for (const layer of Object.keys(FUNNEL_TARGETS_WEEKLY)) {
      if ((it.funnel_layer || '').toLowerCase().includes(layer.toLowerCase())) funnelCounts[layer] += 1;
    }
    const platforms = Array.isArray(it.platforms) ? it.platforms : [];
    for (const p of platforms) if (platformCounts[p] !== undefined) platformCounts[p] += 1;
  }
  const funnelGaps = Object.entries(FUNNEL_TARGETS_WEEKLY)
    .filter(([layer, target]) => funnelCounts[layer] < target)
    .map(([layer, target]) => ({ layer, planned: funnelCounts[layer], target, short_by: target - funnelCounts[layer] }));
  const neglectedPlatforms = Object.entries(platformCounts).filter(([, n]) => n === 0).map(([p]) => p);

  // Last week's review (if any)
  const lastReview = await db.prepare(`SELECT what_worked, what_didnt, next_focus FROM weekly_reviews WHERE week_start = ?`).get([priorWeekStart]);

  // Latest metrics (most recent week per platform)
  const latestMetrics = await db.prepare(`
    SELECT m.platform, m.followers, m.reach, m.engagement_total, m.week_start
    FROM performance_metrics m
    INNER JOIN (
      SELECT platform, MAX(week_start) AS max_week FROM performance_metrics GROUP BY platform
    ) last ON last.platform = m.platform AND last.max_week = m.week_start
  `).all();

  return {
    week_start: weekStart,
    week_end: weekEnd,
    recent_posted: recentPosted,
    upcoming_planned: upcomingPlanned.slice(0, 10),
    funnel_gaps: funnelGaps,
    neglected_platforms: neglectedPlatforms,
    last_review: lastReview,
    latest_metrics: latestMetrics,
  };
}

function buildPrompt(state, newsContext, goalsContext, weekStart) {
  const recentPostedSummary = (state.recent_posted || []).length === 0
    ? 'Nothing posted in the last 14 days yet.'
    : (state.recent_posted || []).map((p) => `- ${p.title} (${p.content_type}, ${p.platform}, ${p.funnel_layer || 'no funnel tag'}) — ${p.updated_at?.toString().slice(0, 10)}`).join('\n');

  const upcomingSummary = (state.upcoming_planned || []).length === 0
    ? 'No upcoming items planned on the calendar yet.'
    : (state.upcoming_planned || []).slice(0, 8).map((p) => `- Wk ${p.week}/${p.day}: ${p.title} (${p.content_type}) — ${p.funnel_layer || 'no funnel'}`).join('\n');

  const gapsSummary = (state.funnel_gaps || []).length === 0
    ? 'Funnel coverage is balanced for the upcoming week.'
    : state.funnel_gaps.map((g) => `- ${g.layer}: ${g.planned}/${g.target} planned (need ${g.short_by} more)`).join('\n');

  const neglectedSummary = (state.neglected_platforms || []).length === 0
    ? 'All platforms have at least some planned coverage.'
    : `Platforms with zero planned content: ${state.neglected_platforms.join(', ')}`;

  const reviewSummary = state.last_review
    ? `LAST WEEK'S REVIEW:\n- What worked: ${state.last_review.what_worked || '(blank)'}\n- What didn't: ${state.last_review.what_didnt || '(blank)'}\n- Next focus: ${state.last_review.next_focus || '(blank)'}`
    : 'No review written for last week.';

  const metricsSummary = (state.latest_metrics || []).length === 0
    ? 'No platform metrics recorded yet.'
    : state.latest_metrics.map((m) => `- ${m.platform}: ${m.followers || '?'} followers${m.reach ? `, ${m.reach} reach` : ''}${m.engagement_total ? `, ${m.engagement_total} engagement` : ''}`).join('\n');

  return `Generate a weekly content briefing for Roodjino Chérilus, Managing Director of Banj Media.

WEEK OF: ${weekStart}

Your job: propose 3-5 specific content angles that (a) tie to what's happening externally right now, (b) fit Roodjino's brand of attention/systems/leverage/execution, (c) fill gaps in the upcoming week's calendar, (d) build on last week's learnings.

===============================
HIS CURRENT STATE
===============================

RECENT POSTED CONTENT (last 14 days):
${recentPostedSummary}

UPCOMING PLANNED CONTENT (top of calendar):
${upcomingSummary}

FUNNEL COVERAGE GAPS (this week's planned items):
${gapsSummary}

NEGLECTED PLATFORMS:
${neglectedSummary}

${reviewSummary}

LATEST PLATFORM METRICS:
${metricsSummary}

===============================
EXTERNAL CONTEXT (from user)
===============================

NEWS / CURRENT EVENTS HE IS WATCHING:
${newsContext || '(none provided — use general knowledge of what\'s happening in AI, media, and Caribbean markets this week)'}

HIS GOALS / WHAT HE WANTS TO LEAN INTO:
${goalsContext || '(none provided — default to continuing the narrative arc from recent posts)'}

===============================
WHAT MAKES A GOOD ANGLE
===============================

A good angle does THREE things at once:
1. Uses a specific external hook (something happening in the world/Haiti that's timely)
2. Connects to a framework Roodjino already owns (Architect Problem, Distribution > Production, AI exposes weak businesses, Legibility vs Expertise, etc.)
3. Fills a concrete gap (funnel layer under-covered, platform neglected, narrative thread from last week)

Avoid:
- Generic trend commentary ("AI is changing everything")
- Angles that don't connect to his actual brand thesis
- Safe takes anyone could write
- Repeating exactly what he just posted

Include:
- Haiti-specific angles when the external context allows it (constraint as diagnostic, building from here, etc.)
- At least one angle that addresses a funnel gap if any exists
- At least one angle that uses a neglected platform if any exists`;
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeObj(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return null;
}

module.exports = router;

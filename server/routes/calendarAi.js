const express = require('express');
const { openDb } = require('../db');
const { generate } = require('../lib/anthropic');

const router = express.Router();

const FUNNEL_TARGETS_WEEKLY = { Discovery: 6, Authority: 4, Trust: 3, Conversion: 2, Identity: 2 };
const PLATFORMS = ['LinkedIn', 'X', 'Instagram', 'Instagram Reels', 'TikTok', 'YouTube'];

router.post('/plan-month', async (req, res, next) => {
  try {
    const {
      theme,
      days = 30,
      platforms = PLATFORMS,
      funnel_targets = FUNNEL_TARGETS_WEEKLY,
      context = '',
      start_week = 1,
      save = false,
    } = req.body || {};
    if (!theme || theme.length < 10) return res.status(400).json({ error: 'theme (10+ chars) required' });

    const weeks = Math.ceil(days / 7);
    const weeklyTotal = Object.values(funnel_targets).reduce((a, b) => a + b, 0);

    const topic = `Generate a ${days}-day content calendar for Roodjino Ch\u00e9rilus, Managing Director of Banj Media.

MONTH THEME / BRIEF:
${theme}

${context ? `ADDITIONAL CONTEXT:\n${context}\n` : ''}
WEEKLY FUNNEL TARGETS (items per week):
${Object.entries(funnel_targets).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
Total per week: ${weeklyTotal}

PLATFORMS ALLOWED:
${platforms.join(', ')}

Respect the 15-day Act structure: Week 1-2 = "The bet is paying off", Week 2-3 = "This is what intelligence looks like", Week 3-4 = "You need to be inside this". Connect items across the month. Multi-platform: no week should use only LinkedIn + X. Presence over frequency.`;

    const extra = `Return ONLY a JSON array. Each element:
{
  "week": 1-${weeks},
  "day": "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun",
  "title": "short 4-10 word title",
  "description": "1-3 sentence brief: the angle, the specific point, the reader takeaway",
  "content_type": "linkedin-long" | "linkedin-short" | "x-thread" | "x-standalone" | "instagram-caption" | "carousel" | "video-clip" | "video-shoot" | "youtube-essay",
  "platforms": ["LinkedIn", "X", ...],
  "funnel_layer": "Discovery" | "Authority" | "Trust" | "Conversion" | "Identity" (or combined)
}
No code fences. Aim for ~${weeklyTotal * weeks} items total.`;

    // Planning should reflect what's actually worked — inject top performers.
    const result = await generate({
      type: 'article', platform: 'calendar', topic, tone: 'sharp', length: 'long', extra,
      useFeedbackLoop: true,
    });
    const parsed = parseJsonArray(result.text);
    if (!parsed.items) return res.json({ items: [], raw: result.text, parse_error: parsed.error });

    if (save) {
      const db = openDb();
      for (const r of parsed.items) {
        await db.prepare(`
          INSERT INTO content_calendar (week, day, title, description, content_type, platforms, funnel_layer, status)
          VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'planned')
        `).run([
          (r.week || 1) + (start_week - 1),
          r.day || null,
          r.title || 'Untitled',
          r.description || '',
          r.content_type || 'linkedin-short',
          JSON.stringify(Array.isArray(r.platforms) ? r.platforms : []),
          r.funnel_layer || 'Discovery',
        ]);
      }
    }

    res.json({ items: parsed.items, count: parsed.items.length, usage: result.usage, saved: save });
  } catch (err) { console.error('[calendar/plan-month]', err); next(err); }
});

router.post('/brainstorm', async (req, res, next) => {
  try {
    const { seed, count = 15, platforms = PLATFORMS, funnel_layers = Object.keys(FUNNEL_TARGETS_WEEKLY) } = req.body || {};
    if (!seed || seed.length < 10) return res.status(400).json({ error: 'seed (10+ chars) required' });

    const topic = `Brainstorm ${count} distinct content angles from this seed idea.

SEED:
${seed}

Cover real range, not minor variations. Each angle must be directly postable.

PLATFORMS ALLOWED:
${platforms.join(', ')}

FUNNEL LAYERS:
${funnel_layers.join(', ')}`;

    const extra = `Return ONLY a JSON array of exactly ${count} objects:
{
  "title": "short working title 4-10 words",
  "hook": "the opening line or premise, 1-2 sentences",
  "why_it_works": "one sentence on what makes this angle specifically interesting",
  "content_type": "linkedin-long" | "linkedin-short" | "x-thread" | "x-standalone" | "instagram-caption" | "carousel" | "video-clip" | "youtube-essay",
  "platforms": [...],
  "funnel_layer": one of the allowed layers
}
No code fences.`;

    // Brainstorm is creative ideation — reference strong past posts.
    const result = await generate({ type: 'article', platform: 'calendar', topic, tone: 'sharp', length: 'medium', extra, useFeedbackLoop: true });
    const parsed = parseJsonArray(result.text);
    res.json({ angles: parsed.items || [], usage: result.usage, parse_error: parsed.error, raw: parsed.error ? result.text : undefined });
  } catch (err) { next(err); }
});

router.post('/:id/deepen', async (req, res, next) => {
  try {
    const db = openDb();
    const item = await db.prepare(`SELECT * FROM content_calendar WHERE id = ?`).get([req.params.id]);
    if (!item) return res.status(404).json({ error: 'Not found' });

    const topic = `Deepen this calendar item into a working brief so Roodjino can write it sharper.

ITEM:
Title: ${item.title}
Content type: ${item.content_type}
Platforms: ${JSON.stringify(item.platforms)}
Funnel layer: ${item.funnel_layer}
Brief: ${item.description}

Produce a working brief, not the final post.`;

    const extra = `Return ONLY a JSON object:
{
  "outline": [ "beat 1", "beat 2", ... ] (5-8 beats for longer formats, 3-5 for short),
  "alternative_angles": [ { "angle": "...", "why": "..." }, ... (3) ],
  "counter_arguments": [ { "objection": "...", "response": "..." }, ... (3) ],
  "supporting_evidence": [ "specific example, stat, or reference", ... (5) ],
  "sharpening_notes": "one paragraph of voice/style notes"
}
No code fences.`;

    // Deepen produces a working brief — feedback loop keeps outlines aligned with working register.
    const result = await generate({ type: 'article', platform: 'calendar', topic, tone: 'sharp', length: 'medium', extra, useFeedbackLoop: true });
    const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      res.json({ ...parsed, usage: result.usage });
    } catch {
      res.json({ parse_error: 'Could not parse JSON', raw: result.text });
    }
  } catch (err) { next(err); }
});

/**
 * POST /api/calendar-ai/:id/refine-brief
 *
 * Revise a specific calendar item's brief (title + description) based on
 * user feedback. Same "iterate, don't rewrite" pattern as the content refine:
 * the AI keeps what works about the current brief and only changes what
 * the feedback calls out.
 *
 * Body: { feedback: string (≥3 chars), scope?: 'brief'|'title'|'both' }
 * Returns: { title, description, usage }
 */
router.post('/:id/refine-brief', async (req, res, next) => {
  try {
    const db = openDb();
    const { feedback, scope = 'both' } = req.body || {};
    if (!feedback || feedback.trim().length < 3) {
      return res.status(400).json({ error: 'feedback must be at least 3 characters' });
    }

    const item = await db.prepare('SELECT * FROM content_calendar WHERE id = ?').get([req.params.id]);
    if (!item) return res.status(404).json({ error: 'Not found' });

    const topic = `Revise a calendar item's brief for Roodjino's content plan.

CURRENT CALENDAR ITEM:
---
Title: ${item.title || '(untitled)'}
Week ${item.week || 1} ${item.day ? `· ${item.day}` : ''} · ${item.content_type || 'post'} · ${item.funnel_layer || 'Discovery'}
Platforms: ${(Array.isArray(item.platforms) ? item.platforms : []).join(', ') || 'not specified'}

Brief: ${item.description || '(no brief)'}
---

USER FEEDBACK ON THIS BRIEF:
---
${feedback}
---

Your task: revise the title and brief to address the feedback. Keep what works. Only change what the feedback calls out or implies. Do NOT start from scratch — iterate on the existing brief. Preserve the content_type, funnel_layer, and platforms unless the feedback explicitly asks you to rethink those too.

A strong brief is 1-3 sentences that capture: the angle, the specific claim/insight, and the reader takeaway. Concrete over abstract. Specific over generic.`;

    const extra = `Return ONLY a JSON object:
{
  "title": "short working title (4-10 words)",
  "description": "the revised brief — 1-3 sentences, concrete"
}
No code fences, no commentary.`;

    const result = await generate({
      type: 'article',
      platform: 'calendar',
      topic,
      tone: 'sharp',
      length: 'short',
      extra,
      useFeedbackLoop: true,
    });

    const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ parse_error: 'Could not parse JSON output from AI', raw: result.text });
    }

    const newTitle = (parsed.title || item.title || 'Untitled').slice(0, 200);
    const newDescription = (parsed.description || item.description || '').slice(0, 4000);

    // Apply based on scope. Default is 'both'.
    const setTitle = scope === 'brief' ? item.title : newTitle;
    const setDesc = scope === 'title' ? item.description : newDescription;

    await db.prepare(`
      UPDATE content_calendar
      SET title = ?, description = ?
      WHERE id = ?
    `).run([setTitle, setDesc, req.params.id]);

    const updated = await db.prepare('SELECT * FROM content_calendar WHERE id = ?').get([req.params.id]);
    res.json({
      title: updated.title,
      description: updated.description,
      usage: result.usage,
    });
  } catch (err) { console.error('[calendar-ai/refine-brief]', err); next(err); }
});

router.get('/gaps', async (req, res, next) => {
  try {
    const db = openDb();
    const rows = await db.prepare(`SELECT week, day, platforms, funnel_layer, status FROM content_calendar ORDER BY week`).all();
    const byWeek = new Map();
    for (const r of rows) {
      if (!byWeek.has(r.week)) byWeek.set(r.week, []);
      byWeek.get(r.week).push(r);
    }

    const weekAnalyses = [];
    for (const [week, items] of byWeek) {
      const funnelCounts = Object.fromEntries(Object.keys(FUNNEL_TARGETS_WEEKLY).map((k) => [k, 0]));
      const platformCounts = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
      for (const it of items) {
        for (const layer of Object.keys(FUNNEL_TARGETS_WEEKLY)) {
          if ((it.funnel_layer || '').toLowerCase().includes(layer.toLowerCase())) funnelCounts[layer] += 1;
        }
        const platforms = Array.isArray(it.platforms) ? it.platforms : [];
        for (const p of platforms) if (platformCounts[p] !== undefined) platformCounts[p] += 1;
      }
      const funnelGaps = Object.entries(FUNNEL_TARGETS_WEEKLY)
        .filter(([layer, target]) => funnelCounts[layer] < target)
        .map(([layer, target]) => ({ layer, planned: funnelCounts[layer], target, short_by: target - funnelCounts[layer] }));
      const platformGaps = Object.entries(platformCounts).filter(([, n]) => n === 0).map(([p]) => p);
      weekAnalyses.push({
        week, total_items: items.length,
        funnel_counts: funnelCounts, platform_counts: platformCounts,
        funnel_gaps: funnelGaps, neglected_platforms: platformGaps,
      });
    }
    res.json({ weekly: weekAnalyses, targets: FUNNEL_TARGETS_WEEKLY });
  } catch (e) { next(e); }
});

router.post('/clear', async (req, res, next) => {
  try {
    const db = openDb();
    // Detach any generated content from calendar items so we don't break FKs
    await db.prepare(`UPDATE generated_content SET calendar_id = NULL WHERE calendar_id IS NOT NULL`).run();
    // Wipe calendar
    const result = await db.prepare(`DELETE FROM content_calendar`).run();
    res.json({ ok: true, deleted: result.changes });
  } catch (e) { next(e); }
});

router.post('/reseed', async (req, res, next) => {
  try {
    const db = openDb();
    const linked = Number((await db.prepare(`SELECT COUNT(*) AS n FROM generated_content WHERE calendar_id IS NOT NULL`).get()).n);
    if (linked > 0 && !req.body?.force) {
      return res.status(400).json({ error: `${linked} generated content rows linked. Pass { "force": true } to wipe.` });
    }
    if (req.body?.force) {
      await db.prepare(`UPDATE generated_content SET calendar_id = NULL WHERE calendar_id IS NOT NULL`).run();
    }
    await db.prepare(`DELETE FROM content_calendar`).run();
    const { CALENDAR_ITEMS } = require('../seed');
    for (const item of CALENDAR_ITEMS) {
      await db.prepare(`
        INSERT INTO content_calendar (week, day, title, description, content_type, platforms, funnel_layer, status)
        VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'planned')
      `).run([item.week, item.day, item.title, item.description, item.content_type, JSON.stringify(item.platforms), item.funnel_layer]);
    }
    const count = Number((await db.prepare(`SELECT COUNT(*) AS n FROM content_calendar`).get()).n);
    res.json({ ok: true, items: count });
  } catch (e) { next(e); }
});

function parseJsonArray(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return { error: 'not an array' };
    return { items: parsed };
  } catch (err) { return { error: `JSON parse failed: ${err.message}` }; }
}

module.exports = router;

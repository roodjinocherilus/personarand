const express = require('express');
const { openDb } = require('../db');
const { generate, invalidateTopPerformersCache } = require('../lib/anthropic');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const db = openDb();
    const { platform, content_type, funnel_layer, status, performance, q, sort } = req.query;
    const clauses = [];
    const params = {};
    if (platform) { clauses.push('gc.platform = @platform'); params.platform = platform; }
    if (content_type) { clauses.push('gc.content_type = @content_type'); params.content_type = content_type; }
    if (status) { clauses.push('gc.status = @status'); params.status = status; }
    if (funnel_layer) { clauses.push('cc.funnel_layer ILIKE @funnel_layer'); params.funnel_layer = `%${funnel_layer}%`; }
    if (performance) { clauses.push('gc.performance = @performance'); params.performance = performance; }
    if (q) { clauses.push('(gc.title ILIKE @q OR gc.body ILIKE @q)'); params.q = `%${q}%`; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    // "best" sort: strong first, then good, then unrated, then poor; within each bucket newest first.
    const orderBy = {
      newest: 'gc.created_at DESC',
      oldest: 'gc.created_at ASC',
      updated: 'gc.updated_at DESC',
      unposted: `CASE WHEN gc.status = 'draft' THEN 0 ELSE 1 END, gc.created_at DESC`,
      best: `CASE gc.performance WHEN 'strong' THEN 0 WHEN 'good' THEN 1 WHEN 'poor' THEN 3 ELSE 2 END, gc.created_at DESC`,
    }[sort] || 'gc.created_at DESC';

    const rows = await db.prepare(`
      SELECT gc.*, cc.funnel_layer AS calendar_funnel_layer, cc.title AS calendar_title, cc.week AS calendar_week,
        (SELECT string_agg(ni.title, ' | ')
          FROM newsletter_content_links ncl
          JOIN newsletter_issues ni ON ni.id = ncl.newsletter_id
          WHERE ncl.content_id = gc.id) AS featured_in_newsletters
      FROM generated_content gc
      LEFT JOIN content_calendar cc ON cc.id = gc.calendar_id
      ${where}
      ORDER BY ${orderBy}
    `).all(params);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/export', async (req, res, next) => {
  try {
    const db = openDb();
    const rows = await db.prepare(`
      SELECT gc.*, cc.funnel_layer AS calendar_funnel_layer, cc.title AS calendar_title, cc.week AS calendar_week
      FROM generated_content gc
      LEFT JOIN content_calendar cc ON cc.id = gc.calendar_id
      ORDER BY gc.created_at DESC
    `).all();

    const date = new Date().toISOString().slice(0, 10);
    const lines = [
      `# Content Library Export`,
      `> Exported ${date} · ${rows.length} entries`,
      ``,
    ];
    for (const r of rows) {
      const created = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '—';
      const status = r.status || '—';
      const platform = r.platform || 'multi';
      const type = r.content_type || '—';
      const perf = r.performance || '—';
      const calInfo = r.calendar_title
        ? `Week ${r.calendar_week} · ${r.calendar_title}${r.calendar_funnel_layer ? ` · ${r.calendar_funnel_layer}` : ''}`
        : 'Free-form';
      lines.push('---');
      lines.push('');
      lines.push(`## ${r.title || 'Untitled'}`);
      lines.push('');
      lines.push(`- **Created:** ${created}`);
      lines.push(`- **Platform:** ${platform}`);
      lines.push(`- **Type:** ${type}`);
      lines.push(`- **Status:** ${status}`);
      lines.push(`- **Performance:** ${perf}`);
      lines.push(`- **Origin:** ${calInfo}`);
      if (r.performance_notes) lines.push(`- **Performance notes:** ${r.performance_notes.replace(/\n/g, ' ')}`);
      lines.push('');
      lines.push(r.body || '');
      lines.push('');
    }
    const markdown = lines.join('\n');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="library-export-${date}.md"`);
    res.send(markdown);
  } catch (e) { next(e); }
});

router.get('/facets', async (req, res, next) => {
  try {
    const db = openDb();
    const platforms = (await db.prepare(`SELECT DISTINCT platform FROM generated_content WHERE platform IS NOT NULL ORDER BY platform`).all()).map((r) => r.platform);
    const content_types = (await db.prepare(`SELECT DISTINCT content_type FROM generated_content WHERE content_type IS NOT NULL ORDER BY content_type`).all()).map((r) => r.content_type);
    const funnel_layers = (await db.prepare(`
      SELECT DISTINCT cc.funnel_layer
      FROM generated_content gc
      LEFT JOIN content_calendar cc ON cc.id = gc.calendar_id
      WHERE cc.funnel_layer IS NOT NULL
      ORDER BY cc.funnel_layer
    `).all()).map((r) => r.funnel_layer);
    res.json({ platforms, content_types, funnel_layers });
  } catch (e) { next(e); }
});

/**
 * Top performers — the most recent `limit` posts the user has rated 'strong'.
 * Used internally by the Opus generate() path to inject tonal reference.
 * Default limit 5; capped at 10 to keep the prompt cost bounded.
 * MUST be declared before `/:id` so Express doesn't treat 'top-performers'
 * as an id parameter.
 */
router.get('/top-performers', async (req, res, next) => {
  try {
    const db = openDb();
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);
    const rows = await db.prepare(`
      SELECT id, title, body, platform, content_type, created_at
      FROM generated_content
      WHERE performance = 'strong'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `).all();
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const row = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { next(e); }
});

router.post('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const { body, body_fr, title, title_fr, status, performance_notes, performance } = req.body || {};
    const existing = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    // Validate performance enum — CHECK constraint also enforces, but fail
    // faster with a clean error.
    if (performance !== undefined && performance !== null && !['poor', 'good', 'strong'].includes(performance)) {
      return res.status(400).json({ error: `performance must be one of: poor, good, strong (got: ${performance})` });
    }

    await db.prepare(`
      UPDATE generated_content
      SET body = ?, body_fr = ?, title = ?, title_fr = ?, status = ?, performance_notes = ?, performance = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run([
      body ?? existing.body,
      body_fr !== undefined ? body_fr : existing.body_fr,
      title ?? existing.title,
      title_fr !== undefined ? title_fr : existing.title_fr,
      status ?? existing.status,
      performance_notes ?? existing.performance_notes,
      performance !== undefined ? performance : existing.performance,
      req.params.id,
    ]);

    // Auto-sync: when content transitions to 'posted' AND it's linked to a
    // calendar item, promote the calendar item's status to 'posted' too. Before
    // this, users had to update both statuses by hand — which is why ratings
    // and "mark as posted" felt broken: clicking posted in the editor never
    // moved the calendar item off 'planned'.
    if (
      status === 'posted'
      && existing.status !== 'posted'
      && existing.calendar_id
    ) {
      try {
        await db.prepare(`UPDATE content_calendar SET status = 'posted' WHERE id = ?`).run([existing.calendar_id]);
      } catch (err) {
        // Non-fatal — content still updated, calendar sync best-effort only.
        console.warn('[library] calendar status sync failed:', err.message);
      }
    }

    const row = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([req.params.id]);
    // If the rating changed, drop the top-performers cache so the next
    // generation call sees the fresh list without waiting 60s.
    if (performance !== undefined && performance !== existing.performance) {
      invalidateTopPerformersCache();
    }
    res.json(row);
  } catch (e) { next(e); }
});

/**
 * POST /api/content/:id/repurpose
 * Turn an existing post into a derivative format — X thread, IG caption,
 * newsletter paragraph, YouTube hook, carousel. The derivative references
 * the parent via parent_content_id so the Library can show lineage and
 * the feedback loop treats them as a family.
 *
 * Body: { target_type: string, target_platform?: string, bilingual?: bool }
 */
router.post('/:id/repurpose', async (req, res, next) => {
  try {
    const db = openDb();
    const { target_type, target_platform, bilingual = false } = req.body || {};
    if (!target_type) return res.status(400).json({ error: 'target_type required' });

    const parent = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([req.params.id]);
    if (!parent) return res.status(404).json({ error: 'Parent content not found' });
    if (!parent.body) return res.status(400).json({ error: 'Parent has no body to repurpose' });

    // Repurpose prompt: pass the original as authoritative source material,
    // ask for a derivative in the target format, preserve voice.
    const topic = `Repurpose an existing post into a different format.

ORIGINAL POST — treat as the truth, the source of the claims and angle:
---
TITLE: ${parent.title || '(untitled)'}
ORIGINAL PLATFORM: ${parent.platform || 'multi'}
ORIGINAL TYPE: ${parent.content_type || 'post'}

${parent.body}
---

REPURPOSE INTO: ${target_type}${target_platform ? ` for ${target_platform}` : ''}

Do not just compress or translate. Reshape for the new format's native behavior. Keep the core argument, the voice, the specific examples. Lose whatever doesn't serve the new format. If the original ran long, find the sharpest angle and cut to it.`;

    const extra = `Return ONLY the new content. No preamble. No "Here's the X version".`;

    const enResult = await generate({
      type: target_type,
      platform: target_platform || parent.platform,
      topic,
      tone: 'sharp',
      length: 'medium',
      extra,
      useFeedbackLoop: true,
    });

    let frResult = null;
    if (bilingual) {
      frResult = await generate({
        type: target_type,
        platform: target_platform || parent.platform,
        topic,
        tone: 'sharp',
        length: 'medium',
        extra,
        useFeedbackLoop: true,
        language: 'fr',
        priorVersion: enResult.text,
      });
    }

    const newTitle = (enResult.text.split('\n').find((l) => l.trim().length > 0) || parent.title || 'Repurposed').slice(0, 120);
    const newTitleFr = frResult
      ? (frResult.text.split('\n').find((l) => l.trim().length > 0) || '').slice(0, 120)
      : null;

    const info = await db.prepare(`
      INSERT INTO generated_content (content_type, platform, title, body, title_fr, body_fr, metadata, status, parent_content_id)
      VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'draft', ?)
    `).run([
      target_type,
      target_platform || parent.platform,
      newTitle,
      enResult.text,
      newTitleFr,
      frResult?.text || null,
      JSON.stringify({ repurposed_from: parent.id, source_type: parent.content_type, usage: enResult.usage, usage_fr: frResult?.usage || null }),
      parent.id,
    ]);
    const row = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([info.lastInsertRowid]);
    res.json({ ...row, usage: enResult.usage, usage_fr: frResult?.usage || null });
  } catch (e) { next(e); }
});

/**
 * POST /api/content/:id/translate-fr
 * Generate the French version of an existing post. Uses the English body as
 * a structural reference and writes a native French version. For when the
 * user generated English-only and decides later they want French too.
 */
router.post('/:id/translate-fr', async (req, res, next) => {
  try {
    const db = openDb();
    const existing = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!existing.body || existing.body.length < 20) {
      return res.status(400).json({ error: 'Post has no English body to use as reference' });
    }

    // Use a minimal "topic" — the real content is carried via priorVersion.
    const result = await generate({
      type: existing.content_type || 'article',
      platform: existing.platform || 'multi',
      topic: existing.title || 'French version',
      tone: 'balanced',
      length: 'medium',
      language: 'fr',
      priorVersion: existing.body,
      useFeedbackLoop: true,
    });

    const titleFr = (result.text.split('\n').find((l) => l.trim().length > 0) || '').slice(0, 120);

    await db.prepare(`
      UPDATE generated_content
      SET body_fr = ?, title_fr = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run([result.text, titleFr, req.params.id]);

    res.json({ body_fr: result.text, title_fr: titleFr, usage: result.usage });
  } catch (e) { next(e); }
});

module.exports = router;

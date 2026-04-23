const express = require('express');
const { openDb } = require('../db');
const { generate, invalidateTopPerformersCache, invalidateRecentEditsCache } = require('../lib/anthropic');

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

/**
 * POST /api/content/rigor-check
 *
 * IMPORTANT ROUTE ORDER: this must live ABOVE the `/:id` and `/:id/*` routes.
 * Express matches routes in registration order; a request to POST
 * /api/content/rigor-check would otherwise get intercepted by POST /:id
 * and attempt to cast the string "rigor-check" to an integer id, which
 * Postgres then rejects with `invalid input syntax for type integer`.
 *
 * Runs a dedicated CRITIC pass against a body of content and returns any
 * violations of the voice document's rigor rules (Evidentiary Rigor section
 * + Prose Discipline). Uses Haiku — this is evaluation, not creation, so
 * the cheaper + faster model fits. The critic has the same cached system
 * prompt as every generation, so it knows the same doctrine the writer does.
 *
 * Body: { body (required, 50+ chars), content_type?, platform?, language?: 'en'|'fr' }
 * Returns: { status, summary, violations: [{ rule, quote, fix, severity }] }
 *
 * No DB write. Pure evaluation. Stateless.
 */
router.post('/rigor-check', async (req, res, next) => {
  try {
    const { body, content_type, platform, language = 'en' } = req.body || {};
    if (!body || body.trim().length < 50) {
      return res.status(400).json({ error: 'body (50+ chars) required' });
    }

    const topic = `You are the RIGOR CRITIC for this brand voice. You are reviewing a draft against the voice document's Evidentiary Rigor and Prose Discipline rules (already in your system prompt). Your job is to FLAG violations, not rewrite.

DRAFT TO REVIEW (${content_type || 'post'} for ${platform || 'LinkedIn'}, ${language === 'fr' ? 'French' : 'English'}):
---
${body.trim()}
---

Return a JSON object with this exact shape:

{
  "status": "pass" | "warn" | "fail",
  "summary": "one sentence on the overall read",
  "violations": [
    {
      "rule": "invented-stats" | "vague-quantifier" | "hedge" | "no-position" | "missing-counter" | "framework" | "prose",
      "quote": "the offending passage, quoted verbatim from the draft",
      "fix": "one-sentence concrete fix the writer can apply",
      "severity": "low" | "medium" | "high"
    }
  ]
}

Rule definitions:

- "invented-stats": a specific percentage, dollar amount, or metric that reads as data but cannot be defended. Flag any specific number that doesn't name its source or context.
- "vague-quantifier": "many," "some," "most," "experts say," "studies show," "a lot of" without specifics. The writer should either name the specific or use honest first-person scope.
- "hedge": "arguably," "it could be said," "many believe," "I think maybe," "perhaps," "some would say." Confident first-person ("I think," "my read is") is NOT hedge — do not flag these.
- "no-position": the draft recaps or summarizes without stating a position. The reader closes the piece without knowing what the writer thinks.
- "missing-counter": the draft makes a claim that has an obvious rebuttal, and the draft never addresses it. Only flag if the counter is genuinely obvious and the piece could be sharpened by naming it.
- "framework": the draft's argument is structurally adjacent to a Signature Doctrine framework (Architect Tax, Distribution Debt, Communication Infrastructure, Constraint as X-Ray, Legibility Gap, Operational Aesthetics, R&D Through Exposure, Presence Compounds) but doesn't name it. Not every piece needs a framework — only flag when one genuinely fits and its absence reads as generic.
- "prose": contains a bullet list or numbered list where Prose Discipline would require full sentences. Does NOT flag justified lists (step-by-step instructions, structured JSON output, parallel enumerations).

Status mapping:
- "pass": no violations, or only 'low' severity items the writer might choose to leave alone
- "warn": one or more 'medium' violations — the draft is publishable but could be sharpened
- "fail": any 'high' severity violation — the draft should be refined before publishing

Be discerning. Do not flag false positives. A post with strong first-person scope and named examples is passing even if it has no statistics at all. A post can pass without every possible framework reference. The critic's job is to catch real violations, not to nitpick polished drafts.`;

    const extra = `Return ONLY the JSON object. No preamble, no explanation, no code fences.`;

    const result = await generate({
      type: 'article',
      platform: 'multi',
      topic,
      tone: 'sharp',
      length: 'short',
      extra,
      model: 'haiku',
      // Critic does NOT use feedback loop — it evaluates, it doesn't mimic.
      useFeedbackLoop: false,
    });

    let parsed;
    try {
      const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.json({
        status: 'warn',
        summary: 'Critic returned unparseable output — treat as passed but re-check manually.',
        violations: [],
        parse_error: true,
        raw: result.text,
      });
    }

    res.json({
      status: parsed.status || 'pass',
      summary: parsed.summary || '',
      violations: Array.isArray(parsed.violations) ? parsed.violations : [],
      usage: result.usage,
    });
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
    const {
      body,
      body_fr,
      title,
      title_fr,
      status,
      performance_notes,
      performance,
      posted_version_en,
      posted_version_fr,
    } = req.body || {};
    const existing = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    // Validate performance enum — CHECK constraint also enforces, but fail
    // faster with a clean error.
    if (performance !== undefined && performance !== null && !['poor', 'good', 'strong'].includes(performance)) {
      return res.status(400).json({ error: `performance must be one of: poor, good, strong (got: ${performance})` });
    }

    // Captions live alongside body but are independent — allow them to be
    // updated without touching body/title. Used by the caption generator
    // endpoint and the in-editor caption textarea.
    const captionEnProvided = req.body?.caption_en !== undefined;
    const captionFrProvided = req.body?.caption_fr !== undefined;

    // First-time posted transition → stamp posted_at. Later status flips don't
    // re-stamp, because we're capturing "when did this first go live" not
    // "when was it last touched".
    const firstPostedTransition = status === 'posted' && existing.status !== 'posted';

    await db.prepare(`
      UPDATE generated_content
      SET body = ?, body_fr = ?, title = ?, title_fr = ?, status = ?,
          performance_notes = ?, performance = ?,
          posted_version_en = ?, posted_version_fr = ?,
          caption_en = ?, caption_fr = ?,
          posted_at = COALESCE(?::timestamptz, posted_at),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run([
      body ?? existing.body,
      body_fr !== undefined ? body_fr : existing.body_fr,
      title ?? existing.title,
      title_fr !== undefined ? title_fr : existing.title_fr,
      status ?? existing.status,
      performance_notes ?? existing.performance_notes,
      performance !== undefined ? performance : existing.performance,
      posted_version_en !== undefined ? posted_version_en : existing.posted_version_en,
      posted_version_fr !== undefined ? posted_version_fr : existing.posted_version_fr,
      captionEnProvided ? req.body.caption_en : existing.caption_en,
      captionFrProvided ? req.body.caption_fr : existing.caption_fr,
      firstPostedTransition ? new Date().toISOString() : null,
      req.params.id,
    ]);

    // Content → Calendar status sync. Mirrors the reverse direction in
    // calendar.js. The mapping is intentionally conservative — we only
    // forward-advance the calendar stage, never regress it:
    //
    //   content 'posted' → calendar 'posted' (regardless of current stage)
    //   content 'scheduled' → calendar 'edited' (if currently behind 'edited')
    //
    // 'draft' and 'archived' never trigger sync.
    if (status && status !== existing.status && existing.calendar_id) {
      try {
        if (status === 'posted') {
          await db.prepare(`UPDATE content_calendar SET status = 'posted' WHERE id = ?`).run([existing.calendar_id]);
        } else if (status === 'scheduled') {
          // Advance calendar to 'edited' only if it's still in an earlier stage.
          await db.prepare(`
            UPDATE content_calendar
            SET status = 'edited'
            WHERE id = ? AND status IN ('planned', 'scripted', 'shot')
          `).run([existing.calendar_id]);
        }
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
    // Same for posted_version changes — an edit just landed, feedback loop
    // should see it immediately on the next generation.
    if (
      (posted_version_en !== undefined && posted_version_en !== existing.posted_version_en)
      || (posted_version_fr !== undefined && posted_version_fr !== existing.posted_version_fr)
    ) {
      invalidateRecentEditsCache();
    }
    res.json(row);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    // Find out what we're deleting before we do it — needed to invalidate caches
    // and to log lineage for anything that referenced this row.
    const existing = await db.prepare('SELECT id, performance, content_type FROM generated_content WHERE id = ?').get([req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    // Detach children (repurposed derivatives) so we don't cascade-kill them.
    // Schema uses ON DELETE SET NULL so this is the safe default, but be
    // explicit here to keep intent obvious.
    await db.prepare('UPDATE generated_content SET parent_content_id = NULL WHERE parent_content_id = ?').run([req.params.id]);
    // Same for the carousel cross-link: the carousel_designs row survives
    // but loses its back-pointer.
    await db.prepare('UPDATE carousel_designs SET content_id = NULL WHERE content_id = ?').run([req.params.id]);

    await db.prepare('DELETE FROM generated_content WHERE id = ?').run([req.params.id]);

    // If the deleted row was a strong-rated performer, top-performers cache
    // is now stale.
    if (existing.performance === 'strong') invalidateTopPerformersCache();

    res.json({ ok: true, deleted_id: Number(req.params.id) });
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
 * POST /api/content/:id/refine
 *
 * Iterative "this isn't quite right — change X" refinement. The AI sees the
 * current draft + the user's specific feedback and revises in-place. Does
 * NOT start from scratch — the prompt is explicit about "iterate, don't
 * rewrite" so 80%-there drafts don't get thrown away.
 *
 * Body: { feedback: string (≥3 chars), language?: 'en'|'fr' }
 * Returns: { body, language, revision_number, usage }
 *
 * Feedback history is persisted into the row's metadata JSON under a
 * `refinements` array so we keep the trail of "what got changed, when, why".
 */
router.post('/:id/refine', async (req, res, next) => {
  try {
    const db = openDb();
    const { feedback, language = 'en' } = req.body || {};
    if (!feedback || feedback.trim().length < 3) {
      return res.status(400).json({ error: 'feedback must be at least 3 characters' });
    }
    if (!['en', 'fr'].includes(language)) {
      return res.status(400).json({ error: `language must be 'en' or 'fr'` });
    }

    const row = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const currentBody = language === 'fr' ? row.body_fr : row.body;
    if (!currentBody || currentBody.length < 20) {
      return res.status(400).json({ error: `no ${language.toUpperCase()} body to refine on this row` });
    }

    const topic = `Revise a ${row.content_type || 'post'} for ${row.platform || 'LinkedIn'}.

YOU PREVIOUSLY WROTE THIS:
---
${currentBody}
---

THE USER HAS GIVEN THIS SPECIFIC FEEDBACK:
---
${feedback}
---

Your task: revise the content to address the feedback. Keep what works. Only change what the feedback calls out or implies. Do NOT start from scratch — iterate on the existing draft. Preserve the length and structure unless the feedback explicitly asks you to change them. If the feedback is vague, interpret it in the direction of sharper voice, more specificity, less generic.`;

    const extra = `Return ONLY the revised content. No preamble, no "Here's the revised version", no markdown code fences, no commentary. Just the new draft as it should appear.`;

    const result = await generate({
      type: row.content_type || 'article',
      platform: row.platform || 'LinkedIn',
      topic,
      tone: 'sharp',
      length: 'medium',
      extra,
      useFeedbackLoop: true,
      language,
      // For FR refinement, feed the current FR draft as priorVersion so the
      // revised output matches the existing structure.
      priorVersion: language === 'fr' ? currentBody : null,
    });

    const revised = result.text.trim();

    // Persist refinement history in metadata. Non-destructive — we keep the
    // full trail so future prompts can reference "what edits did Roodjino
    // ask for" if useful.
    let metadata = {};
    try {
      metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : (row.metadata || {});
    } catch { metadata = {}; }
    if (!Array.isArray(metadata.refinements)) metadata.refinements = [];
    const previousBody = currentBody;
    metadata.refinements.push({
      language,
      feedback,
      previous_body: previousBody.length > 2000 ? previousBody.slice(0, 2000) + '…' : previousBody,
      revised_at: new Date().toISOString(),
      usage: result.usage,
    });
    // Cap the history at last 10 refinements per row so metadata doesn't balloon.
    metadata.refinements = metadata.refinements.slice(-10);

    // Save the new body for the chosen language + updated metadata.
    if (language === 'fr') {
      await db.prepare(`
        UPDATE generated_content
        SET body_fr = ?, metadata = ?::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run([revised, JSON.stringify(metadata), req.params.id]);
    } else {
      await db.prepare(`
        UPDATE generated_content
        SET body = ?, metadata = ?::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run([revised, JSON.stringify(metadata), req.params.id]);
    }

    res.json({
      body: revised,
      language,
      revision_number: metadata.refinements.length,
      usage: result.usage,
    });
  } catch (e) { next(e); }
});

/**
 * POST /api/content/:id/caption
 *
 * Generate the POST CAPTION for a carousel or video — the text that goes
 * ABOVE the media when publishing on LinkedIn/Instagram/TikTok/etc.
 *
 * The body of a carousel/video row describes the MEDIA (slides, script).
 * The caption is the intro text around the media. Different platforms have
 * different norms, so we pass platform-specific guidance into the prompt.
 *
 * Uses Haiku — it's structured, short, and high-volume (you'll generate
 * captions every time you post). ~5x cheaper than Opus with quality that
 * matches for this shape.
 *
 * Body: { platform: 'LinkedIn'|'Instagram'|'TikTok'|'X'|'YouTube', bilingual?: boolean, tone?: string }
 */
router.post('/:id/caption', async (req, res, next) => {
  try {
    const db = openDb();
    const { platform = 'LinkedIn', bilingual = false, tone = 'sharp' } = req.body || {};

    const row = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const isVideo = (row.content_type || '').startsWith('video-') || row.content_type === 'youtube-essay';
    const isCarousel = row.content_type === 'carousel';
    const mediaKind = isVideo ? 'video' : isCarousel ? 'carousel' : 'post';

    // Platform-specific caption norms. Baked as instruction into the prompt.
    const CAPTION_SPECS = {
      LinkedIn: {
        length: '150-600 characters, 3-6 short lines. Hook line first, then context, optional CTA. No hashtags (LinkedIn buries them).',
        voice: 'Professional, confident, opinion-led. No empty platitudes.',
      },
      Instagram: {
        length: '300-800 characters. Hook line, a breath, then context across short paragraphs. End with 5-7 relevant hashtags on a new line.',
        voice: 'Conversational but still sharp. Hashtags at the very end.',
      },
      TikTok: {
        length: 'Under 150 characters. One strong hook line + optional question to prompt comments.',
        voice: 'Punchy, casual, conversational. Emoji sparingly.',
      },
      X: {
        length: 'Under 280 characters total. One sharp line, or a hook line + context. No threads (this is a single post).',
        voice: 'Counter-intuitive or high-specificity. No generic claims.',
      },
      YouTube: {
        length: '500-1200 characters. First 2 lines must hook (shown before "show more"), then expanded context, optional timestamps/CTA.',
        voice: 'Informative with personality. Read like the start of a conversation.',
      },
    };
    const spec = CAPTION_SPECS[platform] || CAPTION_SPECS.LinkedIn;

    const topic = `Write a ${platform} post caption for a ${mediaKind} I already produced.

${mediaKind.toUpperCase()} CONTENT (the media that will be attached — NOT the caption itself):
---
TITLE: ${row.title || '(untitled)'}
${row.body || '(no body)'}
---

CAPTION REQUIREMENTS:
- Platform: ${platform}
- ${spec.length}
- ${spec.voice}
- The caption INTRODUCES or FRAMES the media above. Don't recap the media word-for-word — give someone scrolling a reason to stop and consume it.
- Preserve the voice, frameworks, and doctrine from the system prompt.
- If the media carries the full argument (a carousel or long video), the caption can just hook + context. If the media is tight (a short video), the caption can expand the thesis briefly.`;

    const extra = `Return ONLY the caption text. No preamble, no "Here's the caption", no markdown code fences. Just the caption as it would appear on ${platform}.`;

    const enResult = await generate({
      type: 'article',
      platform,
      topic,
      tone,
      length: 'short',
      extra,
      model: 'haiku', // structured + short + high-volume
      useFeedbackLoop: true,
    });

    let frResult = null;
    if (bilingual) {
      frResult = await generate({
        type: 'article',
        platform,
        topic,
        tone,
        length: 'short',
        extra,
        model: 'haiku',
        useFeedbackLoop: true,
        language: 'fr',
        priorVersion: enResult.text,
      });
    }

    const captionEn = enResult.text.trim();
    const captionFr = frResult?.text?.trim() || null;

    await db.prepare(`
      UPDATE generated_content
      SET caption_en = ?, caption_fr = COALESCE(?, caption_fr), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run([captionEn, captionFr, req.params.id]);

    res.json({
      caption_en: captionEn,
      caption_fr: captionFr,
      platform,
      usage: enResult.usage,
      usage_fr: frResult?.usage || null,
    });
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

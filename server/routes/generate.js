const express = require('express');
const { openDb } = require('../db');
const { generate } = require('../lib/anthropic');
const { parseCarouselText } = require('../lib/carouselParser');
const { persistCarousel } = require('./carousels');

const router = express.Router();

router.post('/content', async (req, res, next) => {
  try {
    const {
      calendar_id,
      type,
      platform,
      topic,
      tone,
      length,
      funnel_layer,
      extra,
      title: providedTitle,
      save = true,
      bilingual = false,
      reactive_source,
      reactive_facts,
      reactive_counter_argument,
    } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });

    // Reactive content: when reactive_source is present, reframe the user
    // message so the AI treats this as TIMELY commentary (24-72h window)
    // rather than evergreen content. Reactive posts travel furthest and get
    // scrutinized hardest — the prompt enforces factual rigor, anticipates
    // the counter-argument, and bans hedge language.
    let effectiveTopic = topic;
    let effectiveExtra = extra;
    if (reactive_source) {
      effectiveTopic = `${topic ? topic + '\n\n' : ''}REACTIVE CONTEXT — this post is commentary on something happening right now:
---
${reactive_source.trim()}
---
${reactive_facts && reactive_facts.trim() ? `
SUPPORTING DATA / FACTS the writer has on hand (integrate where it sharpens the post; do NOT paraphrase the list — weave specific numbers and named examples into the prose):
---
${reactive_facts.trim()}
---
` : ''}${reactive_counter_argument && reactive_counter_argument.trim() ? `
COUNTER-ARGUMENT to pre-empt inline:
---
${reactive_counter_argument.trim()}
---
` : ''}
Reactive posts get the most engagement AND the most scrutiny. This post will be cross-examined by people who want to prove the writer wrong. Write it accordingly.

RIGOR REQUIREMENTS (non-negotiable, all must be met):

1. TAKE A POSITION. No neutral recap. No "interesting development" phrasing. The reader must close the post knowing what the writer thinks. If the writer's conclusion isn't stated explicitly somewhere in the post, the post fails.

2. CITE SPECIFICS, NOT GENERALITIES. Replace vague quantifiers ("many," "some," "most") with actual numbers when the data exists. Replace unnamed actors ("some companies," "experts say") with named examples or explicit acknowledgment that the claim is the writer's own analysis. Every factual claim must be either: (a) directly from the source, (b) from the SUPPORTING DATA block above, (c) general knowledge the writer can defend, or (d) explicitly marked as the writer's interpretation ("my read is...", "what this suggests to me..."). If none of these apply, cut the claim.

3. DO NOT INVENT STATISTICS. No fabricated percentages. No made-up dollar amounts. No invented company metrics. If a specific number would strengthen the post but isn't available, either skip it or frame the claim qualitatively with an honest scope ("two of the three largest Caribbean fintech rounds last quarter," if known to be true; never "78% of companies" if that figure is made up).

4. NAMED EXAMPLES OVER ABSTRACTIONS. "Companies like Stripe and Shopify did X" beats "some companies did X." Use named examples the writer can defend. If an example is hypothetical, mark it ("imagine a company that...").

5. ANTICIPATE THE REBUTTAL. Strong reactive posts name the obvious counter-argument inline and address it, not defensively but as a sharper framing. Weak reactive posts leave the counter in the comments. If a COUNTER-ARGUMENT block is provided above, the post must engage with it. If not provided, the writer identifies the likely counter and addresses it.

6. NO HEDGE LANGUAGE. Remove: "arguably," "it could be said," "many might argue," "some would say," "I think maybe," "perhaps." Replace with direct assertion: "X is true because Y" or "I think X." Hedge language is how confident takes get diluted into nothing.

7. USE EXISTING FRAMEWORK, NAMED. Filter through the brand voice + doctrine. When a framework from the system prompt (Architect Tax, Distribution Debt, Legibility Gap, Operational Aesthetics, Constraint-as-X-Ray, etc.) cuts the problem, name it explicitly. Do NOT invent new frameworks for a one-off reactive post.

8. HAITI LENS when it sharpens the post. When the source intersects Haitian context, the Haiti framing is the differentiator. When it doesn't, forcing Haiti in weakens the post.

9. PROSE DISCIPLINE applies (see system prompt). Full sentences. No bullet lists unless the format genuinely demands them.`;
      effectiveExtra = extra || '';
    }

    const commonArgs = {
      type,
      platform,
      topic: effectiveTopic,
      tone,
      length,
      funnel_layer,
      extra: effectiveExtra,
      useFeedbackLoop: true,
    };

    // Always generate English first. If bilingual is requested, then generate
    // French using the English draft as a structural reference. Sequential
    // (not parallel) so the FR call reads the brand-voice system prompt from
    // cache — saves ~90% on the cached input tokens the second time around.
    const enResult = await generate({ ...commonArgs, language: 'en' });

    let frResult = null;
    if (bilingual) {
      frResult = await generate({ ...commonArgs, language: 'fr', priorVersion: enResult.text });
    }

    if (!save) {
      return res.json({
        text: enResult.text,
        text_fr: frResult?.text || null,
        usage: enResult.usage,
        usage_fr: frResult?.usage || null,
        saved: false,
      });
    }

    // Clean title. Preference order:
    //   1. Explicit `title` passed from the client (calendar-item path).
    //   2. First line of the GENERATED body — the hook line is almost always
    //      a better title than a raw topic string. Matters especially for
    //      the reactive / skip-angles path where there's no cleanly-formed
    //      topic to fall back on.
    //   3. First line of topic (before any "\n\nBrief:" or paragraph break).
    //   4. Safe default based on type / platform.
    function firstMeaningfulLine(s) {
      return (s || '')
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0 && l.length < 140) || '';
    }
    const firstLineFromTopic = (topic || '').split('\n')[0].trim();
    const firstLineFromBody = firstMeaningfulLine(enResult.text);
    const title = (
      providedTitle
      || firstLineFromBody
      || firstLineFromTopic
      || `${type} / ${platform || 'multi'}`
    ).slice(0, 120);

    // Helper: once content is generated for a calendar item, bump its status
    // from 'planned' → 'scripted' so the calendar surface reflects the work.
    // No-op if the item was already advanced (scripted / shot / edited / posted).
    async function advanceCalendarStatus(db) {
      if (!calendar_id) return;
      try {
        await db.prepare(`
          UPDATE content_calendar
          SET status = 'scripted'
          WHERE id = ? AND status = 'planned'
        `).run([calendar_id]);
      } catch (err) {
        console.warn('[generate] calendar advance failed:', err.message);
      }
    }

    // Carousel: dual-write into both generated_content AND carousel_designs so
    // the row shows in the Library (with rating + feedback loop) AND as a
    // designable deck in the Carousel Studio. Before this, generating a
    // carousel from the calendar went into generated_content only and never
    // became an editable deck.
    if (type === 'carousel') {
      const slides = parseCarouselText(enResult.text);
      const { carousel, content } = await persistCarousel({
        title,
        slides,
        rawText: enResult.text,
        templateStyle: 'text-heavy',
        platform: platform || 'LinkedIn',
        funnelLayer: funnel_layer,
        calendarId: calendar_id || null,
        bodyFr: frResult?.text || null,
      });
      await advanceCalendarStatus(openDb());
      return res.json({ ...content, carousel_id: carousel.id, usage: enResult.usage, usage_fr: frResult?.usage || null, saved: true });
    }

    const db = openDb();
    // For the French title, take the first line of the French body if present.
    // Claude usually leads with a hook line that works as a title.
    const titleFr = frResult
      ? (frResult.text.split('\n').find((l) => l.trim().length > 0) || '').slice(0, 120)
      : null;
    const metadata = JSON.stringify({
      tone,
      length,
      model: enResult.model,
      usage: enResult.usage,
      usage_fr: frResult?.usage || null,
      stop_reason: enResult.stop_reason,
      bilingual,
      reactive: Boolean(reactive_source),
    });
    const info = await db.prepare(`
      INSERT INTO generated_content
        (calendar_id, content_type, platform, title, body, title_fr, body_fr,
         metadata, status, is_reactive, reactive_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, 'draft', ?, ?)
    `).run([
      calendar_id || null,
      type,
      platform || null,
      title,
      enResult.text,
      titleFr,
      frResult?.text || null,
      metadata,
      Boolean(reactive_source),
      reactive_source || null,
    ]);
    const row = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([info.lastInsertRowid]);
    await advanceCalendarStatus(db);
    res.json({ ...row, usage: enResult.usage, usage_fr: frResult?.usage || null, saved: true });
  } catch (err) {
    console.error('[generate]', err.message);
    next(err);
  }
});

/**
 * POST /api/generate/hooks
 * Produce 5 sharply different hook variants (first 1-3 sentences) for a
 * topic. Use before committing to a full generation — pick the sharpest
 * hook, paste into `extra` as "Open with: …", then run the full gen.
 *
 * Uses Haiku: it's a structured/short task, Opus is overkill.
 */
router.post('/hooks', async (req, res, next) => {
  try {
    const { topic, platform, type, funnel_layer, count = 5 } = req.body || {};
    if (!topic) return res.status(400).json({ error: 'topic required' });

    const topicPrompt = `Produce ${count} sharply-different HOOK OPENINGS for a ${type || 'post'} on ${platform || 'LinkedIn'}.

TOPIC / BRIEF:
${topic}

${funnel_layer ? `FUNNEL LAYER: ${funnel_layer}\n` : ''}A hook is the first 1-3 sentences — the reason a reader stops scrolling. Each variant must work alone and earn the second line.

Each hook should use a genuinely different angle — counter-intuitive claim, specific number, contrarian framing, named-example cold open, question with an uncomfortable answer, etc. Do NOT generate minor rephrasings of the same thought.`;

    const extra = `Return ONLY a JSON array of ${count} strings. Each element is a hook (1-3 sentences). No code fences, no commentary.`;

    const result = await generate({
      type: 'article',
      platform: platform || 'multi',
      topic: topicPrompt,
      tone: 'sharp',
      length: 'short',
      extra,
      model: 'haiku', // structured short task — Haiku handles this at 5x lower cost
      useFeedbackLoop: true,
    });

    let text = (result.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let hooks = [];
    try { hooks = JSON.parse(text); } catch { return res.json({ hooks: [], raw: result.text, parse_error: 'Could not parse JSON' }); }
    res.json({ hooks, usage: result.usage });
  } catch (err) { next(err); }
});

module.exports = router;

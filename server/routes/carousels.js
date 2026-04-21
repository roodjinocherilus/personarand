const express = require('express');
const { openDb } = require('../db');
const { generate } = require('../lib/anthropic');
const { parseCarouselText } = require('../lib/carouselParser');

const router = express.Router();

/**
 * Persist a carousel into BOTH tables so it appears in the Library (where
 * you rate it, search it, export it) AND in the Carousel Studio (where you
 * edit individual slides and export the design). Returns { carousel, content }.
 *
 * Exported so /api/generate/content can reuse it when type === 'carousel'.
 * Without this dual-write, carousels were invisible to the Library and the
 * feedback loop couldn't learn from a rated carousel.
 */
async function persistCarousel({ title, slides, rawText, templateStyle, platform, funnelLayer, calendarId, bodyFr }) {
  const db = openDb();
  // 1. generated_content row (Library-visible, rate-able, feedback-loop aware)
  const contentInfo = await db.prepare(`
    INSERT INTO generated_content (calendar_id, content_type, platform, title, body, body_fr, metadata, status)
    VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'draft')
  `).run([
    calendarId || null,
    'carousel',
    platform || 'LinkedIn',
    (title || 'Untitled carousel').slice(0, 120),
    rawText,
    bodyFr || null,
    JSON.stringify({ template_style: templateStyle || 'text-heavy', source: 'carousel-studio', slide_count: slides.length }),
  ]);
  const contentId = contentInfo.lastInsertRowid;

  // 2. carousel_designs row (Studio-visible, slide-editable) — cross-linked
  const carouselInfo = await db.prepare(`
    INSERT INTO carousel_designs (title, slides, template_style, status, content_id)
    VALUES (?, ?::jsonb, ?, ?, ?)
  `).run([
    (title || 'Untitled carousel').slice(0, 120),
    JSON.stringify(slides),
    templateStyle || 'text-heavy',
    'draft',
    contentId,
  ]);

  const carousel = await db.prepare('SELECT * FROM carousel_designs WHERE id = ?').get([carouselInfo.lastInsertRowid]);
  const content = await db.prepare('SELECT * FROM generated_content WHERE id = ?').get([contentId]);
  return { carousel: hydrate(carousel), content };
}

router.get('/', async (req, res, next) => {
  try {
    const db = openDb();
    const { status } = req.query;
    const where = status ? 'WHERE status = @status' : '';
    const rows = await db.prepare(`SELECT * FROM carousel_designs ${where} ORDER BY created_at DESC`).all({ status });
    res.json(rows.map(hydrate));
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const row = await db.prepare('SELECT * FROM carousel_designs WHERE id = ?').get([req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(hydrate(row));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const db = openDb();
    const { title, slides, template_style, status } = req.body || {};
    const info = await db.prepare(`
      INSERT INTO carousel_designs (title, slides, template_style, status)
      VALUES (?, ?::jsonb, ?, ?)
    `).run([
      title || 'Untitled carousel',
      JSON.stringify(Array.isArray(slides) ? slides : []),
      template_style || 'text-heavy',
      status || 'draft',
    ]);
    const row = await db.prepare('SELECT * FROM carousel_designs WHERE id = ?').get([info.lastInsertRowid]);
    res.status(201).json(hydrate(row));
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const { title, slides, template_style, status } = req.body || {};
    const existing = await db.prepare('SELECT * FROM carousel_designs WHERE id = ?').get([req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await db.prepare(`
      UPDATE carousel_designs
      SET title = ?, slides = ?::jsonb, template_style = ?, status = ?
      WHERE id = ?
    `).run([
      title ?? existing.title,
      slides !== undefined ? JSON.stringify(Array.isArray(slides) ? slides : []) : JSON.stringify(existing.slides || []),
      template_style ?? existing.template_style,
      status ?? existing.status,
      req.params.id,
    ]);
    const row = await db.prepare('SELECT * FROM carousel_designs WHERE id = ?').get([req.params.id]);
    res.json(hydrate(row));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const result = await db.prepare('DELETE FROM carousel_designs WHERE id = ?').run([req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/generate', async (req, res, next) => {
  try {
    const { topic, slide_count, template_style, tone, funnel_layer, calendar_id, save = true } = req.body || {};
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const extra = [
      slide_count ? `Target exactly ${Number(slide_count)} slides.` : 'Default to 7 slides.',
      `Template style: ${template_style || 'text-heavy'}. Match tone and density to this style.`,
    ].join(' ');

    // Carousels are long-form creative — reference strong past posts for voice.
    const result = await generate({
      type: 'carousel',
      platform: 'LinkedIn',
      topic,
      tone: tone || 'balanced',
      length: 'medium',
      funnel_layer,
      extra,
      useFeedbackLoop: true,
    });

    const slides = parseCarouselText(result.text);

    if (!save) return res.json({ slides, raw: result.text, usage: result.usage, saved: false });

    // Dual-write: generated_content (Library) + carousel_designs (Studio)
    const { carousel, content } = await persistCarousel({
      title: topic,
      slides,
      rawText: result.text,
      templateStyle: template_style,
      platform: 'LinkedIn',
      funnelLayer: funnel_layer,
      calendarId: calendar_id,
    });

    // Auto-advance linked calendar item from planned → scripted.
    if (calendar_id) {
      try {
        const db = openDb();
        await db.prepare(`UPDATE content_calendar SET status = 'scripted' WHERE id = ? AND status = 'planned'`).run([calendar_id]);
      } catch (err) {
        console.warn('[carousel/generate] calendar advance failed:', err.message);
      }
    }

    res.json({ ...carousel, content_id: content.id, raw: result.text, usage: result.usage, saved: true });
  } catch (err) { next(err); }
});

router.post('/parse', (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  res.json({ slides: parseCarouselText(text) });
});

function hydrate(row) {
  if (!row) return row;
  return { ...row, slides: normalizeArray(row.slides) };
}

function normalizeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

module.exports = router;
// Expose the dual-write helper so /api/generate/content can reuse it when
// type === 'carousel' — see routes/generate.js.
module.exports.persistCarousel = persistCarousel;

// Voice Profile routes.
//
// Endpoints:
//   GET  /api/voice-profile                 — current profile (always returns the singleton row)
//   PUT  /api/voice-profile                 — save edits to the profile
//   GET  /api/voice-profile/dimensions      — schema for the UI (labels, weights, hints)
//   GET  /api/voice-profile/extraction-prompt
//                                            — canonical prompt to paste into the user's existing AI
//   POST /api/voice-profile/parse-ai-response
//                                            — parse JSON the user pasted back from their AI; returns a profile draft
//   POST /api/voice-profile/extract-from-corpus
//                                            — Haiku reads pasted past content and proposes a profile draft
//   POST /api/voice-profile/score            — Haiku grades each dimension; persists score_total / score_breakdown
//   POST /api/voice-profile/reset            — wipe back to defaults (rarely used, dangerous, kept for testing)

const express = require('express');
const { openDb } = require('../db');
const {
  DIMENSIONS,
  emptyProfile,
  localScore,
  buildScoringMessage,
  SCORING_SYSTEM_PROMPT,
  computeWeightedScore,
  buildCorpusExtractionMessage,
  CORPUS_EXTRACTION_SYSTEM_PROMPT,
  AI_EXTRACTION_PROMPT,
} = require('../lib/voiceProfile');
const {
  HAIKU_MODEL,
  getClient,
  humanizeAnthropicError,
  invalidateVoiceProfileCache,
} = require('../lib/anthropic');

const router = express.Router();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Read the singleton voice-profiles row. Postgres returns JSONB columns as
 * already-parsed JS values, but defensively coerce anyway since some
 * postgres.js versions hand back strings.
 */
async function readProfile() {
  const db = openDb();
  const rows = await db.prepare(`
    SELECT id, is_primary, display_name, core_thesis, stand_for, stand_against,
           domains_of_authority, frameworks, voice_laws, primary_audiences,
           anti_voice, strategic_horizon, regional_context, source_mode,
           score_total, score_breakdown, score_at, created_at, updated_at
    FROM voice_profiles
    WHERE is_primary = TRUE
    LIMIT 1
  `).all();
  if (!rows || rows.length === 0) return null;
  const row = rows[0];

  // Coerce JSONB columns to plain JS arrays/objects.
  const jsonCols = ['stand_for', 'stand_against', 'domains_of_authority', 'frameworks', 'voice_laws', 'primary_audiences', 'anti_voice', 'score_breakdown'];
  for (const col of jsonCols) {
    if (typeof row[col] === 'string') {
      try { row[col] = JSON.parse(row[col]); } catch { row[col] = col === 'score_breakdown' ? null : []; }
    }
    if (col !== 'score_breakdown' && !Array.isArray(row[col])) row[col] = [];
  }
  return row;
}

/** Strip the response of any markdown fencing and parse JSON. Tolerant. */
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  // Strip ```json ... ``` fencing if present.
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) t = fenceMatch[1].trim();
  // Find the first { and the last } — model sometimes wraps with explanation.
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  try { return JSON.parse(t); } catch { return null; }
}

/** Sanitize an inbound profile blob to the columns we accept. */
function sanitizeProfilePayload(input) {
  const safe = {};
  if (typeof input.display_name === 'string') safe.display_name = input.display_name.slice(0, 200);
  if (typeof input.core_thesis === 'string') safe.core_thesis = input.core_thesis.slice(0, 4000);
  if (typeof input.strategic_horizon === 'string') safe.strategic_horizon = input.strategic_horizon.slice(0, 4000);
  if (typeof input.regional_context === 'string') safe.regional_context = input.regional_context.slice(0, 2000);
  if (typeof input.source_mode === 'string') {
    const allowed = ['questionnaire', 'ai-extraction', 'corpus', 'mixed', 'default'];
    if (allowed.includes(input.source_mode)) safe.source_mode = input.source_mode;
  }
  // List fields — array of non-empty strings only.
  for (const key of ['stand_for', 'stand_against', 'voice_laws', 'anti_voice']) {
    if (Array.isArray(input[key])) {
      safe[key] = input[key].map((s) => String(s || '').trim()).filter(Boolean).slice(0, 30);
    }
  }
  // Pair fields — array of objects with the required keys.
  const pairFieldKeys = {
    domains_of_authority: ['domain', 'why'],
    frameworks: ['name', 'description'],
    primary_audiences: ['audience', 'what_they_need'],
  };
  for (const [key, keys] of Object.entries(pairFieldKeys)) {
    if (Array.isArray(input[key])) {
      safe[key] = input[key]
        .filter((p) => p && typeof p === 'object')
        .map((p) => {
          const out = {};
          for (const k of keys) out[k] = String(p[k] || '').trim().slice(0, 1000);
          return out;
        })
        .filter((p) => keys.some((k) => p[k]))
        .slice(0, 30);
    }
  }
  return safe;
}

// -----------------------------------------------------------------------------
// GET /api/voice-profile
// -----------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    let profile = await readProfile();
    if (!profile) {
      // Bootstrap: migration hasn't run, or the seed didn't insert.
      // Surface an empty-shaped object so the UI renders the wizard.
      profile = { id: null, ...emptyProfile() };
    }
    const local = localScore(profile);
    res.json({
      profile,
      local_score: local,
      cached_score: profile.score_total != null ? {
        total: profile.score_total,
        breakdown: profile.score_breakdown,
        at: profile.score_at,
      } : null,
    });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// GET /api/voice-profile/dimensions  — schema for the UI
// -----------------------------------------------------------------------------

router.get('/dimensions', (req, res) => {
  // Strip the keys the UI shouldn't care about. `pairKeys` IS useful client-side
  // because the wizard renders pair editors generically.
  res.json({
    dimensions: DIMENSIONS.map((d) => ({
      key: d.key,
      label: d.label,
      kind: d.kind,
      weight: d.weight,
      hint: d.hint,
      pairKeys: d.pairKeys,
    })),
    total_weight: DIMENSIONS.reduce((s, d) => s + d.weight, 0),
  });
});

// -----------------------------------------------------------------------------
// GET /api/voice-profile/extraction-prompt
// -----------------------------------------------------------------------------

router.get('/extraction-prompt', (req, res) => {
  res.json({ prompt: AI_EXTRACTION_PROMPT });
});

// -----------------------------------------------------------------------------
// POST /api/voice-profile/parse-ai-response
//
// User pastes the JSON their existing AI returned. We parse it and hand back a
// sanitized profile draft. We do NOT save automatically — the wizard shows
// the draft, lets the user edit, then saves on Confirm.
// -----------------------------------------------------------------------------

router.post('/parse-ai-response', (req, res, next) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });
    const parsed = extractJson(text);
    if (!parsed) {
      return res.status(400).json({
        error: 'Could not parse JSON from the response. Make sure your AI returned valid JSON — copy just the { ... } block.',
      });
    }
    const draft = sanitizeProfilePayload(parsed);
    const local = localScore({ ...emptyProfile(), ...draft });
    res.json({ draft, local_score: local });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// POST /api/voice-profile/extract-from-corpus
//
// Body: { corpus: string, display_name?: string }
// Calls Haiku with the corpus extraction prompt. Returns { draft, raw, local_score }.
// Like parse-ai-response, this returns a draft for the wizard to display —
// it does not save automatically.
// -----------------------------------------------------------------------------

router.post('/extract-from-corpus', async (req, res, next) => {
  try {
    const { corpus, display_name } = req.body || {};
    if (!corpus || typeof corpus !== 'string' || corpus.trim().length < 200) {
      return res.status(400).json({
        error: 'Corpus is too short. Paste at least 200 characters of past content (a few posts, an essay, or a transcript).',
      });
    }

    const message = buildCorpusExtractionMessage(corpus, display_name);
    let response;
    try {
      response = await getClient().messages.create({
        model: HAIKU_MODEL,
        max_tokens: 2500,
        system: [{ type: 'text', text: CORPUS_EXTRACTION_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: message }],
        temperature: 0.3,
      });
    } catch (err) {
      console.warn('[voice-profile] corpus extraction failed:', err?.status, err?.message);
      throw humanizeAnthropicError(err);
    }
    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const parsed = extractJson(raw);
    if (!parsed) {
      return res.status(502).json({
        error: 'The extractor returned non-JSON output. Try again, or paste a different corpus.',
        raw,
      });
    }
    const draft = sanitizeProfilePayload(parsed);
    if (display_name && !draft.display_name) draft.display_name = String(display_name).slice(0, 200);
    const local = localScore({ ...emptyProfile(), ...draft });
    res.json({ draft, local_score: local, model: response.model });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// PUT /api/voice-profile  — save edits
// -----------------------------------------------------------------------------

router.put('/', async (req, res, next) => {
  try {
    const db = openDb();
    const safe = sanitizeProfilePayload(req.body || {});
    const existing = await readProfile();

    if (!existing) {
      // Defensive: should be impossible after migration, but if the bootstrap
      // didn't run (e.g. migration applied without the INSERT), create the row.
      await db.prepare(`
        INSERT INTO voice_profiles (
          is_primary, display_name, core_thesis, stand_for, stand_against,
          domains_of_authority, frameworks, voice_laws, primary_audiences,
          anti_voice, strategic_horizon, regional_context, source_mode
        ) VALUES (
          TRUE, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb,
          ?::jsonb, ?::jsonb, ?, ?, ?
        )
      `).run([
        safe.display_name || null,
        safe.core_thesis || null,
        JSON.stringify(safe.stand_for || []),
        JSON.stringify(safe.stand_against || []),
        JSON.stringify(safe.domains_of_authority || []),
        JSON.stringify(safe.frameworks || []),
        JSON.stringify(safe.voice_laws || []),
        JSON.stringify(safe.primary_audiences || []),
        JSON.stringify(safe.anti_voice || []),
        safe.strategic_horizon || null,
        safe.regional_context || null,
        safe.source_mode || 'questionnaire',
      ]);
    } else {
      // Update only the fields present in the payload — caller may be saving
      // one field at a time.
      const merged = {
        display_name: safe.display_name ?? existing.display_name,
        core_thesis: safe.core_thesis ?? existing.core_thesis,
        stand_for: safe.stand_for ?? existing.stand_for,
        stand_against: safe.stand_against ?? existing.stand_against,
        domains_of_authority: safe.domains_of_authority ?? existing.domains_of_authority,
        frameworks: safe.frameworks ?? existing.frameworks,
        voice_laws: safe.voice_laws ?? existing.voice_laws,
        primary_audiences: safe.primary_audiences ?? existing.primary_audiences,
        anti_voice: safe.anti_voice ?? existing.anti_voice,
        strategic_horizon: safe.strategic_horizon ?? existing.strategic_horizon,
        regional_context: safe.regional_context ?? existing.regional_context,
        source_mode: safe.source_mode ?? existing.source_mode,
      };
      await db.prepare(`
        UPDATE voice_profiles SET
          display_name = ?,
          core_thesis = ?,
          stand_for = ?::jsonb,
          stand_against = ?::jsonb,
          domains_of_authority = ?::jsonb,
          frameworks = ?::jsonb,
          voice_laws = ?::jsonb,
          primary_audiences = ?::jsonb,
          anti_voice = ?::jsonb,
          strategic_horizon = ?,
          regional_context = ?,
          source_mode = ?,
          updated_at = NOW()
        WHERE is_primary = TRUE
      `).run([
        merged.display_name,
        merged.core_thesis,
        JSON.stringify(merged.stand_for || []),
        JSON.stringify(merged.stand_against || []),
        JSON.stringify(merged.domains_of_authority || []),
        JSON.stringify(merged.frameworks || []),
        JSON.stringify(merged.voice_laws || []),
        JSON.stringify(merged.primary_audiences || []),
        JSON.stringify(merged.anti_voice || []),
        merged.strategic_horizon,
        merged.regional_context,
        merged.source_mode || 'mixed',
      ]);
    }

    // Any save invalidates the runtime cache so the next generation picks
    // up the new prompt.
    invalidateVoiceProfileCache();

    const profile = await readProfile();
    const local = localScore(profile);
    res.json({
      profile,
      local_score: local,
      cached_score: profile.score_total != null ? {
        total: profile.score_total,
        breakdown: profile.score_breakdown,
        at: profile.score_at,
      } : null,
    });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// POST /api/voice-profile/score  — Haiku rescores each dimension
// -----------------------------------------------------------------------------

router.post('/score', async (req, res, next) => {
  try {
    const profile = await readProfile();
    if (!profile) return res.status(400).json({ error: 'No profile exists yet. Save the profile first.' });

    const userMessage = buildScoringMessage(profile);
    let response;
    try {
      response = await getClient().messages.create({
        model: HAIKU_MODEL,
        max_tokens: 1500,
        system: [{ type: 'text', text: SCORING_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.2,
      });
    } catch (err) {
      console.warn('[voice-profile] scoring failed:', err?.status, err?.message);
      throw humanizeAnthropicError(err);
    }
    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const parsed = extractJson(raw);
    if (!parsed || !parsed.scores) {
      // Fall back to local heuristic so the UI still gets a number.
      const local = localScore(profile);
      return res.status(502).json({
        error: 'Scorer returned non-JSON. Falling back to local heuristic.',
        local_score: local,
        raw,
      });
    }

    const { total, breakdown } = computeWeightedScore(parsed.scores);

    const db = openDb();
    await db.prepare(`
      UPDATE voice_profiles SET
        score_total = ?,
        score_breakdown = ?::jsonb,
        score_at = NOW(),
        updated_at = NOW()
      WHERE is_primary = TRUE
    `).run([total, JSON.stringify(breakdown)]);

    res.json({
      total,
      breakdown,
      at: new Date().toISOString(),
      model: response.model,
    });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// POST /api/voice-profile/reset  — for testing / fresh starts
// -----------------------------------------------------------------------------

router.post('/reset', async (req, res, next) => {
  try {
    const db = openDb();
    await db.prepare(`
      UPDATE voice_profiles SET
        display_name = NULL,
        core_thesis = NULL,
        stand_for = '[]'::jsonb,
        stand_against = '[]'::jsonb,
        domains_of_authority = '[]'::jsonb,
        frameworks = '[]'::jsonb,
        voice_laws = '[]'::jsonb,
        primary_audiences = '[]'::jsonb,
        anti_voice = '[]'::jsonb,
        strategic_horizon = NULL,
        regional_context = NULL,
        source_mode = 'default',
        score_total = NULL,
        score_breakdown = NULL,
        score_at = NULL,
        updated_at = NOW()
      WHERE is_primary = TRUE
    `).run([]);
    invalidateVoiceProfileCache();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

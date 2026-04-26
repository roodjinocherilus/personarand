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
const { listPacks, getPack } = require('../lib/compliancePacks');
const { listArchetypes, getArchetype } = require('../lib/voiceProfileArchetypes');
const { compileProfileToSystemPrompt } = require('../lib/voiceProfile');
const { BRAND_SYSTEM_PROMPT } = require('../lib/prompts');

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
           compliance_pack,
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

/**
 * Snapshot the current profile into voice_profile_versions before any
 * write. Best-effort — if the versions table is missing (migration not
 * applied yet) we silently skip so the underlying save still succeeds.
 *
 * Auto-prune to retain only the last 50 versions per profile so a user
 * editing daily for a year doesn't accumulate 365 versions of nearly-
 * identical content.
 */
async function snapshotPriorState(db, profileId, sourceAction = 'save') {
  if (!profileId) return;
  try {
    const rows = await db.prepare(`SELECT * FROM voice_profiles WHERE id = ?`).get([profileId]);
    if (!rows) return;
    const snapshot = {
      display_name: rows.display_name || null,
      core_thesis: rows.core_thesis || null,
      stand_for: rows.stand_for || [],
      stand_against: rows.stand_against || [],
      domains_of_authority: rows.domains_of_authority || [],
      frameworks: rows.frameworks || [],
      voice_laws: rows.voice_laws || [],
      primary_audiences: rows.primary_audiences || [],
      anti_voice: rows.anti_voice || [],
      strategic_horizon: rows.strategic_horizon || null,
      regional_context: rows.regional_context || null,
      source_mode: rows.source_mode || null,
      compliance_pack: rows.compliance_pack || null,
    };
    await db.prepare(`
      INSERT INTO voice_profile_versions (profile_id, snapshot, source_action)
      VALUES (?, ?::jsonb, ?)
    `).run([profileId, JSON.stringify(snapshot), sourceAction]);

    // Prune older versions, keep newest 50.
    await db.prepare(`
      DELETE FROM voice_profile_versions
      WHERE profile_id = ?
        AND id NOT IN (
          SELECT id FROM voice_profile_versions
          WHERE profile_id = ?
          ORDER BY created_at DESC
          LIMIT 50
        )
    `).run([profileId, profileId]);
  } catch (err) {
    // Migration probably hasn't run yet — fail silently. The save itself
    // will still proceed; the user just doesn't get versioning until the
    // migration is applied.
    console.warn('[voice-profile] snapshot skipped:', err.message);
  }
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
  // Compliance pack — validated against the registered pack list. Pass
  // null / 'generic' to clear; any unknown id is silently dropped to
  // prevent a typo from persisting an unenforceable pack.
  if (input.compliance_pack === null || input.compliance_pack === 'generic') {
    safe.compliance_pack = null;
  } else if (typeof input.compliance_pack === 'string' && input.compliance_pack.trim()) {
    const known = listPacks().some((p) => p.id === input.compliance_pack);
    if (known) safe.compliance_pack = input.compliance_pack;
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
// GET /api/voice-profile/compiled
//
// Show the user the EXACT system-prompt text their voice profile
// compiles to. This is what the AI sees on every generation. Surfaces:
//   - source: 'profile' (using the compiled voice document) or 'fallback'
//             (legacy hardcoded prompt because the profile is too thin)
//   - prompt: the full text
//   - char_count: rough size signal for the user
//
// Why expose this: trust + debuggability. When a user disagrees with
// the AI's output, the first question should be "is the prompt right?"
// — and they need to see the prompt to answer that. Black-box is bad
// for SaaS positioning.
// -----------------------------------------------------------------------------

/**
 * POST /api/voice-profile/sharpen-dimension
 *
 * Body: { dimension: string }
 *
 * The user's score panel says a specific dimension is weak. They don't
 * always know HOW to make it sharper. This endpoint reads the full
 * profile (so the suggestions feel coherent with everything else the
 * writer believes) and proposes 2-4 concrete improvements specific to
 * the requested dimension.
 *
 * For text fields the suggestions are short rewrites the user can
 * adopt or adapt. For list/pair fields they are individual entries
 * the user can append.
 *
 * Stateless — does not save. The user picks which suggestions to
 * incorporate, edits them, then saves via the regular PUT.
 */
router.post('/sharpen-dimension', async (req, res, next) => {
  try {
    const { dimension } = req.body || {};
    const { DIMENSIONS } = require('../lib/voiceProfile');
    const dim = DIMENSIONS.find((d) => d.key === dimension);
    if (!dim) return res.status(400).json({ error: `Unknown dimension: ${dimension}` });

    const profile = await readProfile();
    if (!profile) return res.status(400).json({ error: 'No profile to sharpen yet — save anything first.' });

    // Compose the user message: full profile context + the specific
    // dimension being sharpened + the kind of output we expect.
    const profileBlock = JSON.stringify({
      display_name: profile.display_name || null,
      core_thesis: profile.core_thesis || null,
      stand_for: profile.stand_for || [],
      stand_against: profile.stand_against || [],
      domains_of_authority: profile.domains_of_authority || [],
      frameworks: profile.frameworks || [],
      voice_laws: profile.voice_laws || [],
      primary_audiences: profile.primary_audiences || [],
      anti_voice: profile.anti_voice || [],
      strategic_horizon: profile.strategic_horizon || null,
      regional_context: profile.regional_context || null,
    }, null, 2);

    const expectedShape = dim.kind === 'text'
      ? '{ "suggestions": ["<rewritten text option 1>", "<option 2>", "<option 3>"] }'
      : dim.kind === 'list'
      ? '{ "suggestions": ["<list entry 1>", "<list entry 2>", ...] }'
      : `{ "suggestions": [${dim.pairKeys.map((k) => `{ "${k}": "..."  }`).join(', ')}] }`;

    const userMessage = `Sharpen the "${dim.label}" dimension of the voice profile below.

Dimension: ${dim.key}
Kind: ${dim.kind}
Hint: ${dim.hint}

CURRENT FULL PROFILE (use this as context — your suggestions must be coherent with everything else the writer believes):

${profileBlock}

Produce 2 to 4 SPECIFIC suggestions for this dimension. Suggestions must:
- Be inimitable — they should sound like only THIS person could have said them, not a generic operator template.
- Cohere with the rest of the profile (their stand_for, stand_against, frameworks, etc.).
- For text dimensions: produce alternative phrasings the user might adopt.
- For list dimensions: produce individual entries the user can append.
- For pair dimensions: produce individual { ${dim.pairKeys?.join(', ')} } objects.

Return STRICT JSON of this exact shape:
${expectedShape}

Output JSON only.`;

    const SYSTEM = `You are a brand-strategist writing partner helping the writer sharpen their voice profile dimension by dimension. You are precise, specific, and you do not invent claims that aren't grounded in the rest of their profile. Output strict JSON only.`;

    let response;
    try {
      response = await getClient().messages.create({
        model: HAIKU_MODEL,
        max_tokens: 1500,
        system: [{ type: 'text', text: SYSTEM }],
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.4,
      });
    } catch (err) {
      console.warn('[voice-profile] sharpen failed:', err?.status, err?.message);
      throw humanizeAnthropicError(err);
    }
    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    let parsed;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const first = cleaned.indexOf('{');
      const last = cleaned.lastIndexOf('}');
      const slice = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
      parsed = JSON.parse(slice);
    } catch {
      return res.status(502).json({ error: 'Sharpener returned non-JSON', raw });
    }

    res.json({
      dimension: dim.key,
      kind: dim.kind,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      model: response.model,
    });
  } catch (e) { next(e); }
});

router.get('/compiled', async (req, res, next) => {
  try {
    const profile = await readProfile();
    let compiled = null;
    let source = 'fallback';
    if (profile) {
      compiled = compileProfileToSystemPrompt(profile);
      if (compiled) source = 'profile';
    }
    const text = compiled || BRAND_SYSTEM_PROMPT;
    res.json({
      source,
      prompt: text,
      char_count: text.length,
      // Surface the cold-start fallback explicitly so the UI can warn
      // when the user thinks they're using their voice but the gate
      // hasn't opened yet (core_thesis < 24 chars or stand_for < 2).
      fallback_reason: source === 'fallback'
        ? (!profile?.core_thesis || profile.core_thesis.trim().length < 24
            ? 'core_thesis is missing or too short (need 24+ chars)'
            : 'stand_for needs at least 2 entries')
        : null,
    });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// GET /api/voice-profile/compliance-packs  — registered packs for the picker
// -----------------------------------------------------------------------------

router.get('/compliance-packs', (req, res) => {
  res.json({ packs: listPacks() });
});

// -----------------------------------------------------------------------------
// GET /api/voice-profile/archetypes        — list of starter archetypes
// GET /api/voice-profile/archetypes/:id    — full archetype starter payload
// -----------------------------------------------------------------------------

router.get('/archetypes', (req, res) => {
  res.json({ archetypes: listArchetypes() });
});

router.get('/archetypes/:id', (req, res) => {
  const a = getArchetype(req.params.id);
  if (!a) return res.status(404).json({ error: 'Archetype not found' });
  res.json({ id: a.id, label: a.label, icon: a.icon, description: a.description, starter: a.starter });
});

// -----------------------------------------------------------------------------
// GET /api/voice-profile/export
//
// Download the current profile as a clean JSON file. We deliberately
// exclude server-side metadata (id, created_at, score caches) — these
// either don't survive an import (id), aren't useful (created_at), or
// would be misleading after import (cached score from a different
// profile state). The export is what the user OWNS — pure profile content.
// -----------------------------------------------------------------------------

router.get('/export', async (req, res, next) => {
  try {
    const profile = await readProfile();
    const date = new Date().toISOString().slice(0, 10);
    const exportPayload = {
      version: 1,
      exported_at: new Date().toISOString(),
      kind: 'voice-profile',
      profile: profile ? {
        display_name: profile.display_name || null,
        core_thesis: profile.core_thesis || null,
        stand_for: profile.stand_for || [],
        stand_against: profile.stand_against || [],
        domains_of_authority: profile.domains_of_authority || [],
        frameworks: profile.frameworks || [],
        voice_laws: profile.voice_laws || [],
        primary_audiences: profile.primary_audiences || [],
        anti_voice: profile.anti_voice || [],
        strategic_horizon: profile.strategic_horizon || null,
        regional_context: profile.regional_context || null,
        source_mode: profile.source_mode || null,
        compliance_pack: profile.compliance_pack || null,
      } : null,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="voice-profile-${date}.json"`);
    res.send(JSON.stringify(exportPayload, null, 2));
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// POST /api/voice-profile/import
//
// Accept a previously-exported JSON payload (or a hand-crafted one in
// the same shape). Validates the version + kind, then sanitizes via
// the same path PUT uses. Returns the post-import profile + score so
// the UI can show the result immediately. Existing fields are
// REPLACED on import — this is opt-in restoration, not a merge. If the
// user wants merging behavior, they should use the archetype / corpus
// / AI-extraction paths instead, which all merge.
// -----------------------------------------------------------------------------

router.post('/import', async (req, res, next) => {
  try {
    const payload = req.body?.payload;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload required' });
    }
    if (payload.kind !== 'voice-profile') {
      return res.status(400).json({ error: `Wrong file kind: expected "voice-profile", got "${payload.kind}"` });
    }
    if (payload.version !== 1) {
      return res.status(400).json({ error: `Unsupported version: ${payload.version}` });
    }
    const incoming = payload.profile || {};
    const safe = sanitizeProfilePayload(incoming);

    const db = openDb();
    const existing = await readProfile();
    // Snapshot prior state before import (replace semantics). The user
    // can roll back to pre-import via History if the import was wrong.
    if (existing) await snapshotPriorState(db, existing.id, 'import');
    if (!existing) {
      await db.prepare(`
        INSERT INTO voice_profiles (
          is_primary, display_name, core_thesis, stand_for, stand_against,
          domains_of_authority, frameworks, voice_laws, primary_audiences,
          anti_voice, strategic_horizon, regional_context, source_mode,
          compliance_pack
        ) VALUES (
          TRUE, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb,
          ?::jsonb, ?::jsonb, ?, ?, ?, ?
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
        safe.source_mode || 'mixed',
        safe.compliance_pack ?? null,
      ]);
    } else {
      // Replace every column with the import — including clearing fields
      // not present in the import. That's the contract of "restore".
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
          compliance_pack = ?,
          score_total = NULL,
          score_breakdown = NULL,
          score_at = NULL,
          updated_at = NOW()
        WHERE is_primary = TRUE
      `).run([
        safe.display_name ?? null,
        safe.core_thesis ?? null,
        JSON.stringify(safe.stand_for || []),
        JSON.stringify(safe.stand_against || []),
        JSON.stringify(safe.domains_of_authority || []),
        JSON.stringify(safe.frameworks || []),
        JSON.stringify(safe.voice_laws || []),
        JSON.stringify(safe.primary_audiences || []),
        JSON.stringify(safe.anti_voice || []),
        safe.strategic_horizon ?? null,
        safe.regional_context ?? null,
        safe.source_mode ?? 'mixed',
        safe.compliance_pack ?? null,
      ]);
    }

    invalidateVoiceProfileCache();

    const profile = await readProfile();
    const local = require('../lib/voiceProfile').localScore(profile);
    res.json({ profile, local_score: local, cached_score: null });
  } catch (e) { next(e); }
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

    // Snapshot prior state before any update — best-effort, skipped on
    // missing migration.
    if (existing) await snapshotPriorState(db, existing.id, 'save');

    if (!existing) {
      // Defensive: should be impossible after migration, but if the bootstrap
      // didn't run (e.g. migration applied without the INSERT), create the row.
      await db.prepare(`
        INSERT INTO voice_profiles (
          is_primary, display_name, core_thesis, stand_for, stand_against,
          domains_of_authority, frameworks, voice_laws, primary_audiences,
          anti_voice, strategic_horizon, regional_context, source_mode,
          compliance_pack
        ) VALUES (
          TRUE, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb,
          ?::jsonb, ?::jsonb, ?, ?, ?, ?
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
        safe.compliance_pack ?? null,
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
        // compliance_pack: explicit null clears; undefined preserves
        compliance_pack: 'compliance_pack' in safe ? safe.compliance_pack : existing.compliance_pack,
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
          compliance_pack = ?,
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
        merged.compliance_pack ?? null,
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
        compliance_pack = NULL,
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

// -----------------------------------------------------------------------------
// GET /api/voice-profile/history  — list past versions
//
// Returns up to 50 most-recent versions for the current profile.
// Each row includes timestamp + source_action + a tiny preview field
// (first 80 chars of the snapshot's core_thesis) so the user can
// recognize "the version before I tried that AI extraction".
//
// Empty array (not 404) when no history exists yet — the user can
// still hit the endpoint without erroring.
// -----------------------------------------------------------------------------

router.get('/history', async (req, res, next) => {
  try {
    const db = openDb();
    const profile = await readProfile();
    if (!profile) return res.json({ versions: [] });

    let rows = [];
    try {
      rows = await db.prepare(`
        SELECT id, source_action, created_at, snapshot
        FROM voice_profile_versions
        WHERE profile_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).all([profile.id]);
    } catch (err) {
      // Migration not applied yet — return empty rather than 500.
      console.warn('[voice-profile] history fetch failed:', err.message);
      return res.json({ versions: [], migration_pending: true });
    }

    const versions = (rows || []).map((r) => {
      // Snapshot is JSONB. Some pg drivers return strings.
      let snap = r.snapshot;
      if (typeof snap === 'string') {
        try { snap = JSON.parse(snap); } catch { snap = {}; }
      }
      return {
        id: r.id,
        source_action: r.source_action || 'save',
        created_at: r.created_at,
        preview: {
          display_name: snap?.display_name || null,
          core_thesis: snap?.core_thesis ? String(snap.core_thesis).slice(0, 200) : null,
          stand_for_count: Array.isArray(snap?.stand_for) ? snap.stand_for.length : 0,
          frameworks_count: Array.isArray(snap?.frameworks) ? snap.frameworks.length : 0,
          compliance_pack: snap?.compliance_pack || null,
        },
      };
    });
    res.json({ versions });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// POST /api/voice-profile/restore/:version_id  — roll back to a snapshot
//
// Snapshots the current state first (with source_action = 'restore'),
// then replaces the active profile columns with the chosen snapshot.
// The cache invalidates so the next generation uses the restored voice.
// -----------------------------------------------------------------------------

router.post('/restore/:version_id', async (req, res, next) => {
  try {
    const db = openDb();
    const profile = await readProfile();
    if (!profile) return res.status(400).json({ error: 'No profile to restore.' });

    let row;
    try {
      row = await db.prepare(`
        SELECT id, snapshot FROM voice_profile_versions
        WHERE id = ? AND profile_id = ?
      `).get([req.params.version_id, profile.id]);
    } catch (err) {
      return res.status(503).json({ error: 'History table not available — apply migration 014 first.' });
    }
    if (!row) return res.status(404).json({ error: 'Version not found.' });

    let snap = row.snapshot;
    if (typeof snap === 'string') {
      try { snap = JSON.parse(snap); } catch { snap = null; }
    }
    if (!snap) return res.status(400).json({ error: 'Snapshot is corrupted; cannot restore.' });

    // Snapshot the current state before overwriting it. This is what
    // makes restore reversible: the user can always undo a restore by
    // restoring the snapshot just created.
    await snapshotPriorState(db, profile.id, 'restore');

    // Apply the snapshot to the active row.
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
        compliance_pack = ?,
        score_total = NULL,
        score_breakdown = NULL,
        score_at = NULL,
        updated_at = NOW()
      WHERE is_primary = TRUE
    `).run([
      snap.display_name ?? null,
      snap.core_thesis ?? null,
      JSON.stringify(snap.stand_for || []),
      JSON.stringify(snap.stand_against || []),
      JSON.stringify(snap.domains_of_authority || []),
      JSON.stringify(snap.frameworks || []),
      JSON.stringify(snap.voice_laws || []),
      JSON.stringify(snap.primary_audiences || []),
      JSON.stringify(snap.anti_voice || []),
      snap.strategic_horizon ?? null,
      snap.regional_context ?? null,
      snap.source_mode ?? 'mixed',
      snap.compliance_pack ?? null,
    ]);

    invalidateVoiceProfileCache();
    const restored = await readProfile();
    const localScoreFn = require('../lib/voiceProfile').localScore;
    res.json({ profile: restored, local_score: localScoreFn(restored), cached_score: null });
  } catch (e) { next(e); }
});

module.exports = router;

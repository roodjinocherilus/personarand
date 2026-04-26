const Anthropic = require('@anthropic-ai/sdk');
const {
  BRAND_SYSTEM_PROMPT,
  TEMPERATURE_BY_TYPE,
  MAX_TOKENS_BY_TYPE,
  buildUserMessage,
} = require('./prompts');
const { query } = require('./db');
const { compileProfileToSystemPrompt } = require('./voiceProfile');

// Fetch active KB entries + format them for system prompt injection.
// Cached for 60s since they change infrequently.
let kbCache = { text: '', at: 0, tokenCount: 0 };
async function getKnowledgeBaseBlock() {
  if (Date.now() - kbCache.at < 60_000) return kbCache;
  try {
    const rows = await query(`
      SELECT title, category, content_md, token_estimate
      FROM knowledge_base
      WHERE is_active = TRUE
      ORDER BY
        CASE category
          WHEN 'positioning' THEN 1
          WHEN 'voice' THEN 2
          WHEN 'framework' THEN 3
          WHEN 'project' THEN 4
          WHEN 'client' THEN 5
          WHEN 'haiti' THEN 6
          ELSE 9
        END,
        updated_at DESC
    `);
    if (rows.length === 0) {
      kbCache = { text: '', at: Date.now(), tokenCount: 0 };
      return kbCache;
    }
    const blocks = rows.map((r) => `### ${r.title} (${r.category})\n${r.content_md}`).join('\n\n---\n\n');
    const wrapped = `\n\n===============================\n# USER-SPECIFIC CONTEXT (living knowledge base)\n===============================\n\nThe following is context Roodjino has added himself. Use it as authoritative when it conflicts with general assumptions. Reference specifics from here when generating content — this is what makes the output not-generic.\n\n${blocks}\n\n===============================\n# END USER CONTEXT\n===============================`;
    const tokenCount = Math.ceil(wrapped.length / 4);
    kbCache = { text: wrapped, at: Date.now(), tokenCount };
    return kbCache;
  } catch (err) {
    console.warn('[kb] fetch failed:', err.message);
    return { text: '', at: Date.now(), tokenCount: 0 };
  }
}
function invalidateKbCache() { kbCache = { text: '', at: 0, tokenCount: 0 }; }

// Voice profile cache. The compiled system prompt is byte-stable for a
// given profile state (any cache invalidation comes from a save in
// /api/voice-profile, which calls invalidateVoiceProfileCache()). Falls
// back silently to the legacy hardcoded BRAND_SYSTEM_PROMPT when the
// table is missing (migration not run) or the row is too thin for the
// compiler to accept.
let voiceProfileCache = { text: '', at: 0, source: 'default' };
async function getVoiceProfileBlock() {
  if (Date.now() - voiceProfileCache.at < 60_000) return voiceProfileCache;
  try {
    const rows = await query(`
      SELECT display_name, core_thesis, stand_for, stand_against,
             domains_of_authority, frameworks, voice_laws,
             primary_audiences, anti_voice, strategic_horizon,
             regional_context, source_mode
      FROM voice_profiles
      WHERE is_primary = TRUE
      LIMIT 1
    `);
    if (!rows || rows.length === 0) {
      voiceProfileCache = { text: '', at: Date.now(), source: 'default' };
      return voiceProfileCache;
    }
    const compiled = compileProfileToSystemPrompt(rows[0]);
    if (!compiled) {
      voiceProfileCache = { text: '', at: Date.now(), source: 'default' };
      return voiceProfileCache;
    }
    voiceProfileCache = { text: compiled, at: Date.now(), source: rows[0].source_mode || 'profile' };
    return voiceProfileCache;
  } catch (err) {
    // Migration probably hasn't run yet — fall back to the hardcoded prompt.
    console.warn('[voice-profile] fetch failed:', err.message);
    voiceProfileCache = { text: '', at: Date.now(), source: 'default' };
    return voiceProfileCache;
  }
}
function invalidateVoiceProfileCache() { voiceProfileCache = { text: '', at: 0, source: 'default' }; }

/**
 * Fetch the user's top-rated posts to inject as tonal reference into new
 * generations. This is what closes the feedback loop: mark posts 'strong'
 * in the Library → they show up here → the AI learns your register.
 *
 * Cached for 60s like the KB. Re-fetched when a rating changes isn't critical
 * (worst case: one stale generation before the cache refreshes).
 *
 * Goes into the USER MESSAGE, not the system prompt, so rating a new post
 * doesn't invalidate the brand-voice cache.
 */
let topPerformersCache = { items: [], at: 0 };
async function getTopPerformers(limit = 5) {
  if (Date.now() - topPerformersCache.at < 60_000 && topPerformersCache.items.length >= limit) {
    return topPerformersCache.items.slice(0, limit);
  }
  try {
    const rows = await query(`
      SELECT title, body, body_fr, title_fr, platform, content_type
      FROM generated_content
      WHERE performance = 'strong'
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    topPerformersCache = { items: rows || [], at: Date.now() };
    return rows || [];
  } catch (err) {
    // If the column doesn't exist yet (migration hasn't run) just return [].
    // The generation still works; it just won't have the feedback loop.
    console.warn('[top-performers] fetch failed:', err.message);
    return [];
  }
}
function invalidateTopPerformersCache() { topPerformersCache = { items: [], at: 0 }; }

/**
 * Fetch recent posts where the user edited the AI's draft before posting.
 * This is the single sharpest teaching signal we have: it literally answers
 * "what do I get wrong that Roodjino has to fix?" Every edit = implicit
 * feedback the AI should absorb.
 *
 * We only return rows where posted_version differs from body (meaningful edits).
 * Cached 60s like the other blocks.
 */
let recentEditsCache = { items: [], at: 0 };
async function getRecentEdits(limit = 3) {
  if (Date.now() - recentEditsCache.at < 60_000 && recentEditsCache.items.length >= limit) {
    return recentEditsCache.items.slice(0, limit);
  }
  try {
    const rows = await query(`
      SELECT
        title, body, posted_version_en,
        title_fr, body_fr, posted_version_fr,
        platform, content_type, posted_at
      FROM generated_content
      WHERE posted_version_en IS NOT NULL
        AND posted_version_en != body
        AND length(body) > 50
      ORDER BY posted_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);
    recentEditsCache = { items: rows || [], at: Date.now() };
    return rows || [];
  } catch (err) {
    // Column might not exist yet (migration pending). Fail soft.
    console.warn('[recent-edits] fetch failed:', err.message);
    return [];
  }
}
function invalidateRecentEditsCache() { recentEditsCache = { items: [], at: 0 }; }

/**
 * Format the edit-delta examples as a text block. The AI gets to see
 * literal "you wrote X → Roodjino actually posted Y" pairs. This is the
 * most direct teaching signal in the entire system.
 *
 * Language-aware: FR generations look at FR edits; EN looks at EN.
 * If a post was only edited in the other language, it's skipped.
 */
function formatRecentEditsBlock(edits, language = 'en') {
  if (!edits || edits.length === 0) return '';
  const pairs = edits.map((e, i) => {
    const wrote = (language === 'fr' ? e.body_fr : e.body) || '';
    const posted = (language === 'fr' ? e.posted_version_fr : e.posted_version_en) || '';
    // Skip if this language wasn't edited.
    if (!wrote || !posted || wrote === posted) return null;
    // Cap lengths so one long post doesn't dominate the block.
    const capW = wrote.length > 1200 ? wrote.slice(0, 1200) + '…' : wrote;
    const capP = posted.length > 1200 ? posted.slice(0, 1200) + '…' : posted;
    return `### Edit example ${i + 1} (${e.platform || 'multi'} / ${e.content_type || 'post'})

YOU WROTE:
${capW}

ROODJINO ACTUALLY POSTED:
${capP}`;
  }).filter(Boolean);
  if (pairs.length === 0) return '';
  return `YOUR DRAFTS vs. WHAT ROODJINO ACTUALLY POSTS (this is what he edits — learn the pattern):

${pairs.join('\n\n---\n\n')}

=== END EDIT EXAMPLES ===

Study the pattern above. What does Roodjino cut? What does he sharpen? What does he tighten? Apply that same editorial hand in your generation below — don't make him do the same edits twice.

---

`;
}

/**
 * Format the top performers as a text block to prepend to the user message.
 * Returns empty string if there are no rated posts — first-time users see
 * the exact same behavior as before, no regression.
 */
function formatTopPerformersBlock(performers, language = 'en') {
  if (!performers || performers.length === 0) return '';
  // When generating in French, prefer the French version of the post when
  // present (native voice reference); fall back to English if the rated post
  // was only ever in English. This means strong-rated FR posts teach FR tone,
  // strong-rated EN posts teach EN tone, and mixed is handled gracefully.
  const excerpts = performers.map((p, i) => {
    const preferFr = language === 'fr' && p.body_fr && p.body_fr.length > 0;
    const body = (preferFr ? p.body_fr : p.body) || '';
    const title = (preferFr ? p.title_fr : p.title) || '';
    const excerpt = body.slice(0, 600);
    const truncated = body.length > 600 ? '…' : '';
    return `### Strong post ${i + 1} — ${p.platform || 'multi'} / ${p.content_type || 'post'}${preferFr ? ' [FR]' : ''}\n${title ? `TITLE: ${title}\n` : ''}${excerpt}${truncated}`;
  }).join('\n\n---\n\n');
  return `YOUR RECENT STRONG-PERFORMING POSTS (Roodjino rated these as "strong" — use them as tonal and structural reference; these are what your audience actually responded to):

${excerpts}

=== END REFERENCE POSTS ===

Now handle the request below. The reference posts above are for voice calibration only — do not copy their subject matter.

---

`;
}

// Default model for original long-form creative work (Generate, Plan, Brainstorm,
// Briefing, Deepen, Carousels, Newsletter expand). Opus 4.7 is top-tier quality.
const MODEL = 'claude-opus-4-7';
// Lightweight model for structured extraction, classification, templating.
// Haiku 4.5 is ~5x cheaper on input and ~5x cheaper on output than Opus 4.7
// and handles JSON extraction / short personalization / gaps analysis just fine.
const HAIKU_MODEL = 'claude-haiku-4-5';

// Resolve a model override keyword to the actual model ID. Accepts:
//   - undefined / 'opus'  → default Opus 4.7
//   - 'haiku'             → Haiku 4.5
//   - an explicit model ID string → passed through verbatim (escape hatch)
function resolveModel(override) {
  if (!override || override === 'opus') return MODEL;
  if (override === 'haiku') return HAIKU_MODEL;
  return override;
}

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
    }
    // Vercel Hobby caps each serverless function at 60s. We cap the Anthropic
    // call at 45s so the request has time to return a useful error instead of
    // letting the gateway kill it cold. The SDK also auto-retries 429 / 5xx
    // internally (default 2 retries with exponential backoff) — we just don't
    // need to hand-roll that part.
    client = new Anthropic.default({ apiKey, timeout: 45_000, maxRetries: 2 });
  }
  return client;
}

/**
 * Translate an SDK error into a clean error with a user-friendly message.
 * The routes catch this and surface the message verbatim to the UI, so it
 * needs to be something a non-technical user can act on.
 */
function humanizeAnthropicError(err) {
  const status = err?.status || err?.response?.status;
  const e = new Error();
  e.cause = err;
  if (status === 429) {
    e.status = 429;
    const retryAfter = err?.headers?.['retry-after'] || err?.response?.headers?.['retry-after'];
    e.message = retryAfter
      ? `Rate-limited by Anthropic. Try again in ~${retryAfter}s.`
      : 'Rate-limited by Anthropic. Try again in a minute.';
    return e;
  }
  if (status === 400) {
    const errType = err?.error?.type || err?.response?.data?.error?.type;
    if (errType === 'moderation' || /refus|policy/i.test(err?.message || '')) {
      e.status = 400;
      e.message = 'Claude declined the request on content-policy grounds. Try rephrasing.';
      return e;
    }
    e.status = 400;
    e.message = `Invalid request: ${err?.message || 'unknown'}`;
    return e;
  }
  if (err?.name === 'APIConnectionTimeoutError' || /timeout|timed out/i.test(err?.message || '')) {
    e.status = 504;
    e.message = 'Claude took too long to respond (45s timeout). Shorten the prompt or retry.';
    return e;
  }
  if (status >= 500) {
    e.status = status;
    e.message = 'Anthropic is having trouble right now. Try again in a moment.';
    return e;
  }
  e.status = status || 500;
  e.message = err?.message || 'AI generation failed';
  return e;
}

async function generate({ type, platform, topic, tone, length, funnel_layer, extra, model, useFeedbackLoop = false, language = 'en', priorVersion = null }) {
  const normalizedType = type || 'linkedin-short';
  let userMessage = buildUserMessage({
    type: normalizedType,
    platform,
    topic,
    tone,
    length,
    funnel_layer,
    extra,
  });

  // Inject the user's top-rated prior posts as tonal reference. Opt-in via
  // `useFeedbackLoop: true` — default stays off so Haiku extraction tasks
  // don't eat tokens on irrelevant context.
  if (useFeedbackLoop) {
    // Two signal blocks, ordered from "what works" → "what I edit" → task.
    // Edits come AFTER performers because they're more specific corrective
    // signal; we want the model to read performers first (set voice ceiling),
    // then edits (corrections to watch for), then the actual task.
    const [performers, edits] = await Promise.all([
      getTopPerformers(5),
      getRecentEdits(3),
    ]);
    const performersBlock = formatTopPerformersBlock(performers, language);
    const editsBlock = formatRecentEditsBlock(edits, language);
    if (editsBlock) userMessage = editsBlock + userMessage;
    if (performersBlock) userMessage = performersBlock + userMessage;
  }

  // Bilingual mode: Roodjino's audience straddles English and French. When
  // `language === 'fr'`, we instruct Claude to write *originally* in French
  // (not translate a hidden English version) while preserving the brand
  // voice and frameworks from the cached system prompt. If a `priorVersion`
  // (English draft) is passed, we use it as a STRUCTURAL reference so the
  // French version matches the beats — without copy-translating it.
  if (language === 'fr') {
    const frInstruction = priorVersion
      ? `

===============================
FRENCH VERSION REQUEST
===============================

An English draft was already produced (below as reference). Write this same piece in NATURAL, IDIOMATIC FRENCH — write as if you had drafted it originally in French, not a translation. Match the English version's structure, beats, and argument flow, but phrase everything in native French register.

Rules:
- Do NOT translate sentence-by-sentence. Rewrite in French.
- Preserve signature framework NAMES where they read well in French (e.g. "Architect Tax" → "La taxe de l'architecte" if that fits the rhythm; some names stay English if that's the natural choice for a Haitian audience fluent in both).
- Keep the same voice laws, rhetorical style, and doctrine references as the system prompt specifies — the voice is the same person, just speaking French.
- The Haitian context matters: audience is fluent in French and often in English too, so the French should read as sophisticated, not academic.
- Match the English version's length roughly. Not longer, not shorter.
- Return ONLY the French content. No preamble, no "Here is the French version", no commentary.

ENGLISH REFERENCE (structure only — do not translate):
---
${priorVersion}
---`
      : `

===============================
FRENCH VERSION REQUEST
===============================

Write this content in NATURAL, IDIOMATIC FRENCH. Write as if you had drafted it originally in French — not a translation from English. Preserve the brand voice, doctrine, and rhetorical style from the system prompt (that voice is the same person speaking French). The audience is Haitian and fluent in French; aim for sophisticated register, not academic.

Return ONLY the French content. No preamble.`;
    userMessage = userMessage + frInstruction;
  }

  const maxTokens = MAX_TOKENS_BY_TYPE[normalizedType] || 1500;
  const temperature = TEMPERATURE_BY_TYPE[normalizedType] ?? 0.7;
  const resolvedModel = resolveModel(model);

  // System prompt has two layers:
  //   1. Brand voice (cached — stable across all calls, same voice on Haiku or Opus)
  //   2. User knowledge base (cached separately — changes when user edits KB)
  // Caches are per-model, so Haiku and Opus warm independently. This is fine:
  // outreach personalization is bursty (many calls in a session → warm cache),
  // and weekly tasks amortize the cache write against cheaper per-token rates.
  // Voice profile takes precedence over the hardcoded BRAND_SYSTEM_PROMPT
  // when the user has filled enough of their profile for the compiler to
  // produce a valid prompt (see compileProfileToSystemPrompt — requires
  // at least core_thesis + 2 stand_for entries). Otherwise we keep the
  // legacy Roodjino voice as the cold-start default so a fresh install
  // still generates sensible output before onboarding.
  const [kb, voice] = await Promise.all([
    getKnowledgeBaseBlock(),
    getVoiceProfileBlock(),
  ]);
  const brandBlock = voice.text || BRAND_SYSTEM_PROMPT;
  const systemBlocks = [
    { type: 'text', text: brandBlock, cache_control: { type: 'ephemeral' } },
  ];
  if (kb.text) {
    systemBlocks.push({ type: 'text', text: kb.text, cache_control: { type: 'ephemeral' } });
  }

  const params = {
    model: resolvedModel,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: [
      { role: 'user', content: userMessage },
    ],
  };
  // Opus 4.7 removed the temperature parameter entirely; any other model
  // (Haiku 4.5, Sonnet 4.6, etc.) still accepts it.
  if (!resolvedModel.startsWith('claude-opus-4-7')) {
    params.temperature = temperature;
  }

  let response;
  try {
    response = await getClient().messages.create(params);
  } catch (err) {
    // Log raw error server-side for debugging; throw humanized for the UI.
    console.warn('[anthropic] generate failed:', err?.status, err?.message);
    throw humanizeAnthropicError(err);
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return {
    text,
    model: response.model,
    usage: response.usage,
    stop_reason: response.stop_reason,
  };
}

async function healthCheck() {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'reply with the single word: ok' }],
    });
    const text = response.content.map((b) => b.text || '').join('').trim().toLowerCase();
    return { ok: text.includes('ok'), model: response.model };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  generate,
  healthCheck,
  MODEL,
  HAIKU_MODEL,
  resolveModel,
  getClient,
  humanizeAnthropicError,
  invalidateKbCache,
  invalidateTopPerformersCache,
  invalidateRecentEditsCache,
  invalidateVoiceProfileCache,
  getKnowledgeBaseBlock,
  getVoiceProfileBlock,
};

// Voice Profile — the structured representation of a user's brand voice
// that gets compiled into the system prompt for every generation.
//
// This module is deliberately small and pure. It defines:
//
//   1. The 10 dimensions and their weights (totals 100).
//   2. A scoring rubric the Haiku critic uses to grade completeness.
//   3. A profile-→-prompt compiler that turns the structured profile
//      into the shape of system prompt the rest of the codebase already
//      expects (matches the structure of BRAND_SYSTEM_PROMPT in prompts.js).
//   4. The canonical AI-extraction prompt that users paste into their
//      existing AI to have it propose a voice profile from the AI's
//      memory of them.
//
// Why structured-then-compiled instead of just storing free-form markdown?
//   - Scoring needs to evaluate dimension-by-dimension. Free-form text is
//     hard to grade fairly.
//   - Onboarding needs a wizard. A wizard needs explicit fields.
//   - Per-customer rule injection (compliance critic, framework-named
//     critic) needs to read individual fields, not parse markdown.
//   - The compiled prompt remains byte-stable for any given profile state,
//     so prompt caching (cache_control: ephemeral) keeps working — until
//     the user edits, at which point we expect (and want) a cache miss.

// -----------------------------------------------------------------------------
// Dimensions
// -----------------------------------------------------------------------------

/**
 * The 10 weighted dimensions. Order is the order the UI renders them in.
 * Weight sum = 100 so score_total is already a percentage with no extra
 * normalization step.
 *
 * `kind` controls how the dimension is graded:
 *   - 'text'  — single string field; grade on substance + specificity
 *   - 'list'  — JSONB array; grade on count + quality (≥3 items expected)
 *   - 'pairs' — JSONB array of objects; grade on count + each having required keys
 */
const DIMENSIONS = [
  {
    key: 'core_thesis',
    label: 'Core thesis',
    kind: 'text',
    weight: 15,
    hint: 'The single sentence that organizes everything you say. What is your central argument about how the world works in your domain?',
  },
  {
    key: 'stand_for',
    label: 'What you stand for',
    kind: 'list',
    weight: 10,
    hint: 'Positions you hold openly. Each item should be a stance someone could disagree with.',
  },
  {
    key: 'stand_against',
    label: 'What you stand against',
    kind: 'list',
    weight: 10,
    hint: 'Patterns, beliefs, or behaviors you reject. The clarity here defines your edge.',
  },
  {
    key: 'domains_of_authority',
    label: 'Domains of authority',
    kind: 'pairs',
    weight: 10,
    hint: 'The 3–5 areas where you have legitimate authority. Each needs a "why" — what gives you the right to speak on it.',
    pairKeys: ['domain', 'why'],
  },
  {
    key: 'frameworks',
    label: 'Named frameworks',
    kind: 'pairs',
    weight: 10,
    hint: 'Repeatable mental models you use in your work, each with a memorable name. (E.g., "the architect problem", "the operator-class gap".)',
    pairKeys: ['name', 'description'],
  },
  {
    key: 'voice_laws',
    label: 'Voice laws',
    kind: 'list',
    weight: 10,
    hint: 'Hard rules for how your content reads. ("Write in prose, never bullet points." "Name the framework." "No hedging.")',
  },
  {
    key: 'primary_audiences',
    label: 'Primary audiences',
    kind: 'pairs',
    weight: 10,
    hint: 'Who you write for, and what they need from you. Be specific — "founders building under hard constraints" beats "entrepreneurs".',
    pairKeys: ['audience', 'what_they_need'],
  },
  {
    key: 'anti_voice',
    label: 'Anti-voice',
    kind: 'list',
    weight: 8,
    hint: 'Patterns you avoid. ("Generic LinkedIn motivational tone." "Consultant jargon." "Polished case-study voice that hides struggle.")',
  },
  {
    key: 'strategic_horizon',
    label: 'Strategic horizon',
    kind: 'text',
    weight: 9,
    hint: 'The arc you are building toward over the next 6–12 months. What story should this year of content tell?',
  },
  {
    key: 'regional_context',
    label: 'Regional / cultural context',
    kind: 'text',
    weight: 8,
    hint: 'Geographic or cultural anchoring that gives your voice gravity. (For Roodjino: Haiti and the Caribbean reality.)',
  },
];

const TOTAL_WEIGHT = DIMENSIONS.reduce((s, d) => s + d.weight, 0); // = 100

// -----------------------------------------------------------------------------
// Profile shape helpers
// -----------------------------------------------------------------------------

function emptyProfile() {
  return {
    display_name: '',
    core_thesis: '',
    stand_for: [],
    stand_against: [],
    domains_of_authority: [],
    frameworks: [],
    voice_laws: [],
    primary_audiences: [],
    anti_voice: [],
    strategic_horizon: '',
    regional_context: '',
    source_mode: 'default',
  };
}

/** True when a dimension is non-empty enough to be worth scoring. */
function hasContent(profile, dim) {
  const v = profile[dim.key];
  if (dim.kind === 'text') return typeof v === 'string' && v.trim().length >= 12;
  if (dim.kind === 'list') return Array.isArray(v) && v.filter((x) => String(x || '').trim()).length > 0;
  if (dim.kind === 'pairs') {
    return Array.isArray(v) && v.some((p) => p && dim.pairKeys.every((k) => String(p[k] || '').trim().length > 0));
  }
  return false;
}

/**
 * Heuristic local score (0–100) for instant feedback while typing, before
 * any AI scoring runs. The Haiku critic produces a more nuanced number.
 *
 * Per-dimension score is `min(100, contentSize / target * 100)`:
 *   - text  → ≥120 chars = full points
 *   - list  → ≥4 entries = full points
 *   - pairs → ≥3 complete entries = full points
 */
function localScore(profile) {
  const breakdown = {};
  let weighted = 0;
  for (const dim of DIMENSIONS) {
    const v = profile[dim.key];
    let raw = 0;
    if (dim.kind === 'text') {
      const len = String(v || '').trim().length;
      raw = Math.min(100, Math.round((len / 120) * 100));
    } else if (dim.kind === 'list') {
      const n = Array.isArray(v) ? v.filter((x) => String(x || '').trim()).length : 0;
      raw = Math.min(100, Math.round((n / 4) * 100));
    } else if (dim.kind === 'pairs') {
      const n = Array.isArray(v)
        ? v.filter((p) => p && dim.pairKeys.every((k) => String(p[k] || '').trim().length > 0)).length
        : 0;
      raw = Math.min(100, Math.round((n / 3) * 100));
    }
    const w = (raw / 100) * dim.weight;
    weighted += w;
    breakdown[dim.key] = {
      score: raw,
      weight: dim.weight,
      weighted: Math.round(w * 10) / 10,
      label: dim.label,
    };
  }
  return {
    total: Math.round(weighted),
    breakdown,
    method: 'local',
  };
}

// -----------------------------------------------------------------------------
// Profile → System prompt compiler
// -----------------------------------------------------------------------------

/**
 * Compile a structured voice profile into the shape of system prompt the
 * generation pipeline expects. The output is byte-stable for a given
 * profile state, so prompt caching keeps working between calls.
 *
 * If the profile is too thin (any required dimension empty), returns null
 * so the caller can fall back to the legacy hardcoded BRAND_SYSTEM_PROMPT.
 */
function compileProfileToSystemPrompt(profile) {
  if (!profile) return null;

  // Require the two highest-weight dimensions to be present. Without these
  // the AI has nothing distinctive to ground itself on.
  if (!profile.core_thesis || profile.core_thesis.trim().length < 24) return null;
  const standCount = Array.isArray(profile.stand_for) ? profile.stand_for.filter(Boolean).length : 0;
  if (standCount < 2) return null;

  const lines = [];
  const name = (profile.display_name || 'this user').trim();

  lines.push(`You are the content generation engine for ${name}.`);
  lines.push('');
  lines.push('Your job is not to generate "content."');
  lines.push('Your job is to produce strategic media assets that build authority, create demand, increase legibility, strengthen market position, and turn public thinking into commercial leverage.');
  lines.push('');

  lines.push('# CORE THESIS');
  lines.push('');
  lines.push(profile.core_thesis.trim());
  lines.push('');

  if (profile.stand_for?.length) {
    lines.push('# WHAT THIS PERSON STANDS FOR');
    lines.push('');
    for (const item of profile.stand_for) if (String(item || '').trim()) lines.push(`- ${String(item).trim()}`);
    lines.push('');
  }

  if (profile.stand_against?.length) {
    lines.push('# WHAT THIS PERSON STANDS AGAINST');
    lines.push('');
    for (const item of profile.stand_against) if (String(item || '').trim()) lines.push(`- ${String(item).trim()}`);
    lines.push('');
  }

  if (profile.domains_of_authority?.length) {
    lines.push('# DOMAINS OF AUTHORITY');
    lines.push('');
    lines.push('Speak from inside these domains. Outside them, defer or stay quiet.');
    lines.push('');
    for (const p of profile.domains_of_authority) {
      if (!p || !p.domain) continue;
      lines.push(`- **${String(p.domain).trim()}** — ${String(p.why || '').trim()}`);
    }
    lines.push('');
  }

  if (profile.frameworks?.length) {
    lines.push('# NAMED FRAMEWORKS');
    lines.push('');
    lines.push('When relevant, name the framework. The name is part of the asset.');
    lines.push('');
    for (const p of profile.frameworks) {
      if (!p || !p.name) continue;
      lines.push(`- **${String(p.name).trim()}** — ${String(p.description || '').trim()}`);
    }
    lines.push('');
  }

  if (profile.primary_audiences?.length) {
    lines.push('# PRIMARY AUDIENCES');
    lines.push('');
    for (const p of profile.primary_audiences) {
      if (!p || !p.audience) continue;
      lines.push(`- ${String(p.audience).trim()} — ${String(p.what_they_need || '').trim()}`);
    }
    lines.push('');
  }

  if (profile.voice_laws?.length) {
    lines.push('# VOICE LAWS');
    lines.push('');
    lines.push('These are hard rules. Violating them produces output that does not sound like this person.');
    lines.push('');
    for (const item of profile.voice_laws) if (String(item || '').trim()) lines.push(`- ${String(item).trim()}`);
    lines.push('');
  }

  if (profile.anti_voice?.length) {
    lines.push('# ANTI-VOICE — DO NOT SOUND LIKE THIS');
    lines.push('');
    for (const item of profile.anti_voice) if (String(item || '').trim()) lines.push(`- ${String(item).trim()}`);
    lines.push('');
  }

  if (profile.strategic_horizon && profile.strategic_horizon.trim()) {
    lines.push('# STRATEGIC HORIZON');
    lines.push('');
    lines.push(profile.strategic_horizon.trim());
    lines.push('');
  }

  if (profile.regional_context && profile.regional_context.trim()) {
    lines.push('# REGIONAL / CULTURAL CONTEXT');
    lines.push('');
    lines.push(profile.regional_context.trim());
    lines.push('');
  }

  // Universal discipline rules — same shape as the legacy hardcoded prompt
  // so other parts of the system (rigor critic, evidentiary checks) keep
  // their assumptions valid.
  lines.push('# EVIDENTIARY RIGOR');
  lines.push('');
  lines.push('Every claim must be defensible. Cite specifics — concrete examples, named cases, real numbers — not invented statistics. If you do not have the number, do not invent one. Use directional language ("most", "many", "a meaningful share") only when grounded in observable patterns. Hedge language ("perhaps", "maybe", "it could be argued") is forbidden — take a position.');
  lines.push('');
  lines.push('# PROSE DISCIPLINE');
  lines.push('');
  lines.push('Write in prose. Not in bullet points. Not in headers. Sentences and paragraphs that flow. Bullets are reserved for lists of named items (audiences, frameworks, laws) — never for argument structure.');
  lines.push('');

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Scoring (Haiku)
// -----------------------------------------------------------------------------

/**
 * Build the user-message payload for the Haiku scorer. The system prompt
 * stays cacheable across all profiles by being entirely about the rubric,
 * with the actual profile content delivered in the user message.
 */
function buildScoringMessage(profile) {
  const lines = [];
  lines.push('Grade this voice profile, dimension by dimension. For each dimension, return a score 0–100 and a one-sentence note on what would push the score higher.');
  lines.push('');
  lines.push('Rubric (per dimension):');
  lines.push('  0–20   — empty or trivial content');
  lines.push('  21–40  — present but vague / generic / could apply to anyone');
  lines.push('  41–60  — specific and substantive but thin (one or two examples)');
  lines.push('  61–80  — distinctive, well-articulated, and grounded in concrete instances');
  lines.push('  81–100 — sharp, defensible, and clearly inimitable — could only come from this person');
  lines.push('');
  lines.push('Return STRICT JSON of the shape:');
  lines.push('  { "scores": { "<dimension_key>": { "score": <int>, "note": "<one sentence>" }, ... } }');
  lines.push('');
  lines.push('Dimensions and current content:');
  lines.push('');

  for (const dim of DIMENSIONS) {
    const v = profile[dim.key];
    lines.push(`## ${dim.key} (${dim.label}) — weight ${dim.weight}`);
    lines.push(`Hint: ${dim.hint}`);
    lines.push('Content:');
    if (dim.kind === 'text') {
      lines.push(String(v || '').trim() || '(empty)');
    } else if (dim.kind === 'list') {
      const arr = Array.isArray(v) ? v.filter((x) => String(x || '').trim()) : [];
      lines.push(arr.length ? arr.map((x) => `- ${x}`).join('\n') : '(empty)');
    } else if (dim.kind === 'pairs') {
      const arr = Array.isArray(v) ? v.filter((p) => p && dim.pairKeys.every((k) => String(p[k] || '').trim())) : [];
      lines.push(arr.length ? arr.map((p) => `- ${dim.pairKeys.map((k) => `${k}: ${p[k]}`).join(' | ')}`).join('\n') : '(empty)');
    }
    lines.push('');
  }

  lines.push('Output JSON only. No prose around it.');
  return lines.join('\n');
}

const SCORING_SYSTEM_PROMPT = `You are a brand-strategist critic evaluating the completeness and distinctiveness of a personal-brand voice profile.

For each dimension below you will receive its current content. Grade it 0–100 against the rubric in the user message. Higher = more distinctive, more specific, more inimitable. Be honest — vague generic content gets 30, not 70.

Output strict JSON only.`;

/**
 * Combine raw 0–100 per-dimension scores into a weighted total + breakdown
 * matching the schema's score_breakdown shape.
 */
function computeWeightedScore(rawScores) {
  const breakdown = {};
  let weighted = 0;
  for (const dim of DIMENSIONS) {
    const r = rawScores[dim.key] || { score: 0, note: '' };
    const score = Math.max(0, Math.min(100, Number(r.score) || 0));
    const w = (score / 100) * dim.weight;
    weighted += w;
    breakdown[dim.key] = {
      score,
      weight: dim.weight,
      weighted: Math.round(w * 10) / 10,
      note: r.note || '',
      label: dim.label,
    };
  }
  return {
    total: Math.round(weighted),
    breakdown,
  };
}

// -----------------------------------------------------------------------------
// Corpus extraction
// -----------------------------------------------------------------------------

/**
 * Build the message that asks Haiku to extract a starter voice profile
 * from a corpus of pasted past content.
 */
function buildCorpusExtractionMessage(corpus, displayName) {
  const corpusTrimmed = String(corpus || '').slice(0, 60_000); // keep the call cheap
  return [
    `Read the corpus below — past posts, essays, or talks by ${displayName || 'this person'}.`,
    'Extract a structured voice profile. Be specific — pull actual phrases, named frameworks, recurring stances.',
    '',
    'Return STRICT JSON of the shape:',
    '{',
    '  "core_thesis": "<one sentence — the central argument that organizes everything>",',
    '  "stand_for": ["...", "..."],',
    '  "stand_against": ["...", "..."],',
    '  "domains_of_authority": [{ "domain": "...", "why": "..." }, ...],',
    '  "frameworks": [{ "name": "...", "description": "..." }, ...],',
    '  "voice_laws": ["...", "..."],',
    '  "primary_audiences": [{ "audience": "...", "what_they_need": "..." }, ...],',
    '  "anti_voice": ["...", "..."],',
    '  "strategic_horizon": "<the 6–12 month arc you can infer>",',
    '  "regional_context": "<geographic or cultural anchoring, or empty string>"',
    '}',
    '',
    'Rules:',
    '- Use exact phrases from the corpus where possible.',
    '- If a dimension is not supported by the corpus, return an empty string or empty array — DO NOT invent.',
    '- Frameworks: only list names that actually appear in the text (look for repeated phrases used as concepts).',
    '- Voice laws: infer from style, not content. ("Writes in prose, no bullets." "Names the framework before explaining it.")',
    '',
    '--- CORPUS ---',
    corpusTrimmed,
    '--- END CORPUS ---',
    '',
    'Output JSON only.',
  ].join('\n');
}

const CORPUS_EXTRACTION_SYSTEM_PROMPT = `You are a brand-strategist extractor. You read a corpus of someone's past public writing and infer their structured voice profile from it. You are precise, you do not invent, and you ground every dimension in observable patterns from the text.

Output strict JSON only.`;

// -----------------------------------------------------------------------------
// AI-extraction prompt (for users to paste into their existing AI)
// -----------------------------------------------------------------------------

/**
 * Returned to the UI so the user can copy it and paste it into ChatGPT,
 * Claude, or whichever AI they already use heavily. The AI's response then
 * gets pasted back into the onboarding wizard, parsed, and used as the
 * starter profile.
 */
const AI_EXTRACTION_PROMPT = `You have known me through our conversations. Based on everything you know about me — my work, my positions, my recurring frameworks, what I push back on, who I'm building for — produce a structured voice profile.

Return STRICT JSON of the shape:

{
  "core_thesis": "<one sentence — the central argument that organizes my work>",
  "stand_for": ["<position>", "<position>", "<position>"],
  "stand_against": ["<rejected pattern>", "<rejected pattern>"],
  "domains_of_authority": [
    { "domain": "<area>", "why": "<what gives me legitimate authority on it>" }
  ],
  "frameworks": [
    { "name": "<short memorable name>", "description": "<one-sentence definition>" }
  ],
  "voice_laws": ["<style rule>", "<style rule>"],
  "primary_audiences": [
    { "audience": "<who>", "what_they_need": "<what they need from me>" }
  ],
  "anti_voice": ["<voice or pattern I avoid>", "<...>"],
  "strategic_horizon": "<the 6–12 month arc I am building toward>",
  "regional_context": "<geographic or cultural anchoring>"
}

Rules:
- Be specific. Vague generic answers are worse than empty fields.
- If you genuinely don't know a dimension, return an empty string or empty array — do not invent.
- Pull exact phrases I have used when you have them.
- 3–5 entries per list field is a good target.

Output JSON only — no prose, no markdown, no explanation around it.`;

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  DIMENSIONS,
  TOTAL_WEIGHT,
  emptyProfile,
  hasContent,
  localScore,
  compileProfileToSystemPrompt,
  buildScoringMessage,
  SCORING_SYSTEM_PROMPT,
  computeWeightedScore,
  buildCorpusExtractionMessage,
  CORPUS_EXTRACTION_SYSTEM_PROMPT,
  AI_EXTRACTION_PROMPT,
};

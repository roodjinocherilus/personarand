// Crisis mode — when something blows up publicly and the operator
// suddenly needs the comms team they don't have.
//
// One endpoint, two AI calls, returned in a single response:
//
//   1. ASSESS  (Haiku)  — decision matrix: respond now / wait / private
//                          / silent. Reasoning, channel, tone, timing,
//                          risks, things to avoid.
//   2. DRAFTS  (Opus)   — three graded response variants written in the
//                          user's voice (the system prompt already pulls
//                          their voice profile + voice laws + compliance
//                          pack):
//                            A. minimal acknowledgement
//                            B. full position
//                            C. redirect-to-action
//
// Why both calls in one endpoint instead of two: the user is ALREADY
// stressed when they open this page. The product job is to compress
// "I need to respond to this" → "here's the assessment + three drafts"
// into a single shot. Two calls in parallel keep total latency around a
// single Opus call.
//
// The endpoint never auto-saves. The user picks a draft, edits it, and
// saves manually via the existing /api/content endpoints. That keeps
// crisis output reviewable rather than committed.

const express = require('express');
const {
  HAIKU_MODEL,
  MODEL: OPUS_MODEL,
  getClient,
  humanizeAnthropicError,
  getKnowledgeBaseBlock,
  getVoiceProfileBlock,
} = require('../lib/anthropic');
const { BRAND_SYSTEM_PROMPT } = require('../lib/prompts');
const { openDb } = require('../db');

const router = express.Router();

// -----------------------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------------------

const ASSESS_SYSTEM_PROMPT = `You are a senior communications strategist who has handled real reputational crises for executives. You make calm, defensible recommendations under pressure. You do not catastrophize. You also do not tell the user to "stay silent" reflexively — silence has costs too. You weigh both.

Output strict JSON only. No prose around it.`;

function buildAssessMessage(situation) {
  return `A reputational situation needs assessment. Read it carefully and recommend a response strategy.

SITUATION:
---
${situation.what_happened}
---

CONTEXT:
- Visibility: ${situation.visibility?.length ? situation.visibility.join(', ') : 'unknown'}
- Severity (1=noise, 5=legal/contractual): ${situation.severity || 3}
- People / orgs involved: ${situation.involved || '—'}
- Our position / our truth: ${situation.our_position || '—'}
- Is the claim true? ${situation.claim_truth || 'unclear'}

Return STRICT JSON of this exact shape:

{
  "primary_action": "respond_publicly" | "respond_privately" | "stay_silent" | "wait_24h",
  "reasoning": "<2-3 sentences. Why this action over the alternatives. Be honest about tradeoffs.>",
  "if_respond": {
    "channel": "LinkedIn" | "X" | "press_statement" | "personal_email" | "internal_only",
    "tone": "measured" | "firm" | "warm" | "factual",
    "timing": "now" | "in_4h" | "tomorrow" | "after_facts_clarify"
  },
  "risks": [
    { "scenario": "<what could go wrong>", "likelihood": "low" | "medium" | "high", "mitigation": "<one sentence>" }
  ],
  "what_to_avoid": ["<concrete thing not to say or do>", "<another>"]
}

Rules:
- "primary_action" must match what you actually believe is right, even if uncomfortable.
- "wait_24h" is a real option when the facts are still moving — use it when premature speech is the bigger risk.
- 2–4 risks. No filler. Order them by severity descending.
- 2–4 items in what_to_avoid. Concrete, not abstract.

Output JSON only.`;
}

const DRAFTS_SYSTEM_PROMPT_SUFFIX = `

# CRISIS DRAFTING DIRECTIVE

You are now drafting graded response options for a reputational situation. You will produce THREE variants. Each must:
- Sound unmistakably like the writer (their voice document is in this system prompt above).
- Be defensible — no claims that can't be substantiated.
- Avoid the things in the "what to avoid" list passed by the user.
- Use the writer's prose discipline (no bullets unless the writer's voice laws explicitly allow them).
- Stay in the channel and tone the assessment recommends.

Variant A — MINIMAL ACKNOWLEDGEMENT (60–120 words)
  Just enough to be on record. Does not relitigate. Closes the immediate
  loop without committing to a longer back-and-forth.

Variant B — FULL POSITION (200–300 words)
  States what happened, what the writer's actual position is, and why.
  Reads like a piece the writer would publish on a normal day, applied
  to the situation.

Variant C — REDIRECT-TO-ACTION (100–180 words)
  Acknowledges the situation briefly, then pivots to what is being done
  about it — concrete steps, decisions, or commitments. Replaces
  rhetoric with movement.

Output STRICT JSON of this exact shape:

{
  "variant_a": "<minimal acknowledgement>",
  "variant_b": "<full position>",
  "variant_c": "<redirect to action>"
}

Output JSON only. No code fences. No headings. Each variant must be the
final draft text, ready to publish (after the user reviews).`;

function buildDraftsUserMessage(situation, assessment) {
  return `Draft three response variants for the situation below, applying the assessment's directives.

SITUATION:
---
${situation.what_happened}
---

OUR POSITION:
${situation.our_position || '(not stated — infer carefully)'}

ASSESSMENT DIRECTIVE:
- Channel: ${assessment.if_respond?.channel || 'LinkedIn'}
- Tone: ${assessment.if_respond?.tone || 'measured'}
- Things to avoid: ${(assessment.what_to_avoid || []).join(' / ') || '(none specified)'}

Produce variant_a, variant_b, variant_c as specified in the system prompt.

Output JSON only.`;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  try { return JSON.parse(t); } catch { return null; }
}

// -----------------------------------------------------------------------------
// POST /api/crisis/assess  — assess + draft in one shot
// -----------------------------------------------------------------------------

router.post('/assess', async (req, res, next) => {
  try {
    const situation = req.body?.situation || {};
    if (!situation.what_happened || String(situation.what_happened).trim().length < 30) {
      return res.status(400).json({ error: 'situation.what_happened (30+ chars) required' });
    }

    // Step 1: assessment with Haiku — fast and cheap.
    const client = getClient();
    let assessResp;
    try {
      assessResp = await client.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 1500,
        system: [{ type: 'text', text: ASSESS_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: buildAssessMessage(situation) }],
        temperature: 0.3,
      });
    } catch (err) {
      console.warn('[crisis] assess failed:', err?.status, err?.message);
      throw humanizeAnthropicError(err);
    }
    const assessRaw = assessResp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const assessment = extractJson(assessRaw);
    if (!assessment) {
      return res.status(502).json({ error: 'Assessment returned non-JSON.', raw: assessRaw });
    }

    // If the recommendation is to stay silent or wait, skip the drafting
    // step — the user shouldn't have draft fingers on the keyboard while
    // the recommendation says don't post.
    const skipDrafts = ['stay_silent', 'wait_24h'].includes(assessment.primary_action);

    let drafts = null;
    if (!skipDrafts) {
      // Step 2: drafts with Opus — high-quality voiced output.
      // Reuse the same system block layout as generate(): voice profile
      // (or fallback hardcoded prompt) + KB + crisis directive suffix.
      const [kb, voice] = await Promise.all([
        getKnowledgeBaseBlock(),
        getVoiceProfileBlock(),
      ]);
      const brandBlock = (voice.text || BRAND_SYSTEM_PROMPT) + DRAFTS_SYSTEM_PROMPT_SUFFIX;
      const systemBlocks = [
        { type: 'text', text: brandBlock, cache_control: { type: 'ephemeral' } },
      ];
      if (kb.text) {
        systemBlocks.push({ type: 'text', text: kb.text, cache_control: { type: 'ephemeral' } });
      }

      let draftsResp;
      try {
        draftsResp = await client.messages.create({
          model: OPUS_MODEL,
          max_tokens: 3000,
          system: systemBlocks,
          messages: [{ role: 'user', content: buildDraftsUserMessage(situation, assessment) }],
          // Opus 4.7 doesn't accept temperature; same shape as generate().
        });
      } catch (err) {
        console.warn('[crisis] drafts failed:', err?.status, err?.message);
        // Don't fail the whole request — return assessment without drafts
        // so the user still gets useful guidance.
        return res.json({
          assessment,
          drafts: null,
          drafts_error: err?.message || 'Draft generation failed',
        });
      }
      const draftsRaw = draftsResp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      drafts = extractJson(draftsRaw);
      if (!drafts) {
        return res.json({
          assessment,
          drafts: null,
          drafts_error: 'Draft generator returned non-JSON',
          drafts_raw: draftsRaw,
        });
      }
    }

    res.json({
      assessment,
      drafts,
      skipped_drafts: skipDrafts,
    });
  } catch (e) { next(e); }
});

// -----------------------------------------------------------------------------
// POST /api/crisis/save-draft  — write an edited crisis draft into Library
//
// This is intentionally a separate write path from /api/generate/content
// because the user's edited draft is NOT a generation — it's a saved
// artifact. Using the generate endpoint would re-run the AI and replace
// the user's edits.
// -----------------------------------------------------------------------------

router.post('/save-draft', async (req, res, next) => {
  try {
    const { title, body, platform, content_type } = req.body || {};
    if (!body || String(body).trim().length < 10) {
      return res.status(400).json({ error: 'body (10+ chars) required' });
    }
    const db = openDb();
    const cleanTitle = (title && String(title).trim()) || `[Crisis] ${String(body).trim().split(/\n+/)[0].slice(0, 60)}`;
    const info = await db.prepare(`
      INSERT INTO generated_content (
        calendar_id, title, body, content_type, platform, funnel_layer, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run([
      null,
      cleanTitle,
      String(body).trim(),
      content_type || 'article',
      platform || 'LinkedIn',
      'Trust',
      'draft',
    ]);
    const row = await db.prepare(`SELECT * FROM generated_content WHERE id = ?`).get([info.lastInsertRowid]);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

module.exports = router;

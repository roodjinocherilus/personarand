// Reply Assistant — drafts in-voice responses to inbound messages.
//
// Different from Crisis mode (public reputational situations) and from
// Outreach (cold-start prospecting): this is the daily friction of
// 1:1 conversations — DMs, comments, mentions, follow-ups — where the
// reply needs to sound like the user, respect what's already been said,
// and serve a specific outcome the user has in mind.
//
// Flow: user pastes the inbound, names the relationship + their intent,
// and gets three graded reply options:
//   - brief    : 1-3 sentences, just enough to acknowledge / advance
//   - full     : 80-180 words, the substantive reply
//   - redirect : 50-100 words, acknowledges then pivots to action / next step

const express = require('express');
const {
  MODEL: OPUS_MODEL,
  HAIKU_MODEL,
  getClient,
  humanizeAnthropicError,
  getKnowledgeBaseBlock,
  getVoiceProfileBlock,
} = require('../lib/anthropic');
const { BRAND_SYSTEM_PROMPT } = require('../lib/prompts');

const router = express.Router();

const REPLY_DRAFTING_SUFFIX = `

# REPLY ASSISTANT DIRECTIVE

You are now drafting reply options to an inbound message the writer
received. You will produce THREE variants:

Variant BRIEF — 1–3 sentences
  Just enough to acknowledge or advance. The right choice when the
  writer wants to be on record without committing to a longer thread.

Variant FULL — 80–180 words
  The substantive reply. Reads like a piece the writer would post on
  a normal day, scoped down to a 1:1 conversation. Engages with what
  was said. Stays in their voice (system prompt above).

Variant REDIRECT — 50–100 words
  Acknowledges briefly, then pivots to action or a clear next step
  ("happy to discuss live — here's a link to my calendar"). For when
  the right reply is to take the conversation somewhere else.

Rules:
- Address WHAT the inbound actually said. No generic templates.
- Do not flatter the sender unless the inbound itself was substantive
  enough to deserve a substantive thank-you.
- Match the channel register: DMs read shorter than emails; comments
  read shorter than DMs.
- Stay inside the writer's voice laws and avoid the writer's anti-voice
  patterns (both in the system prompt above).
- Honor the writer's stated INTENT — what they actually want this
  reply to accomplish.

Output STRICT JSON of this exact shape:

{
  "brief":    "<1-3 sentence reply>",
  "full":     "<80-180 word reply>",
  "redirect": "<50-100 word redirect-to-action reply>"
}

Output JSON only. No code fences. No headings. Each variant must be the
final draft text, ready to send (after the user reviews).`;

const CHANNEL_HINTS = {
  dm:        'Direct message (LinkedIn / X / Instagram). Conversational register, no salutation needed.',
  comment:   'Public comment thread. Visible to others. Short and sharp.',
  email:     'Email. Salutation + sign-off appropriate. More formal than DM but not stiff.',
  followup:  'Follow-up to a prior conversation. Reference what was discussed before.',
};

function buildUserMessage({ incoming, situation, intent, channel, sender }) {
  const ch = CHANNEL_HINTS[channel] || CHANNEL_HINTS.dm;
  const lines = [];
  lines.push('Draft three reply variants for the inbound message below.');
  lines.push('');
  lines.push(`CHANNEL: ${ch}`);
  if (sender) lines.push(`SENDER: ${sender}`);
  if (situation) {
    lines.push('');
    lines.push('CONTEXT (relationship, prior history, where this is happening):');
    lines.push(situation);
  }
  if (intent) {
    lines.push('');
    lines.push('WRITER\'S INTENT (what they want this reply to accomplish):');
    lines.push(intent);
  }
  lines.push('');
  lines.push('INBOUND MESSAGE:');
  lines.push('---');
  lines.push(incoming.trim());
  lines.push('---');
  lines.push('');
  lines.push('Produce brief, full, redirect as specified in the system prompt.');
  lines.push('');
  lines.push('Output JSON only.');
  return lines.join('\n');
}

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

router.post('/draft', async (req, res, next) => {
  try {
    const { incoming, situation, intent, channel, sender, fast } = req.body || {};
    if (!incoming || String(incoming).trim().length < 10) {
      return res.status(400).json({ error: 'incoming (10+ chars) required' });
    }

    const [kb, voice] = await Promise.all([
      getKnowledgeBaseBlock(),
      getVoiceProfileBlock(),
    ]);
    const brandBlock = (voice.text || BRAND_SYSTEM_PROMPT) + REPLY_DRAFTING_SUFFIX;
    const systemBlocks = [
      { type: 'text', text: brandBlock, cache_control: { type: 'ephemeral' } },
    ];
    if (kb.text) {
      systemBlocks.push({ type: 'text', text: kb.text, cache_control: { type: 'ephemeral' } });
    }

    // fast=true uses Haiku — about 5x cheaper, slightly less polished. Good
    // for high-volume reply work where the user will polish manually anyway.
    const model = fast ? HAIKU_MODEL : OPUS_MODEL;

    let response;
    try {
      const params = {
        model,
        max_tokens: 2000,
        system: systemBlocks,
        messages: [{ role: 'user', content: buildUserMessage({ incoming, situation, intent, channel, sender }) }],
      };
      // Opus 4.7 doesn't accept temperature; Haiku 4.5 does.
      if (model === HAIKU_MODEL) params.temperature = 0.5;
      response = await getClient().messages.create(params);
    } catch (err) {
      console.warn('[reply-assistant] draft failed:', err?.status, err?.message);
      throw humanizeAnthropicError(err);
    }
    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const parsed = extractJson(raw);
    if (!parsed) {
      return res.status(502).json({ error: 'Drafter returned non-JSON', raw });
    }

    res.json({
      drafts: {
        brief:    parsed.brief    || '',
        full:     parsed.full     || '',
        redirect: parsed.redirect || '',
      },
      model: response.model,
      mode: fast ? 'fast' : 'voiced',
    });
  } catch (e) { next(e); }
});

module.exports = router;

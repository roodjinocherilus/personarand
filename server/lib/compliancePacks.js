// Compliance rule packs — pre-defined rule sets keyed to specific
// professional contexts. The user picks one (or none) on their voice
// profile; the rigor critic then flags violations specific to that pack
// in addition to the universal rigor rules and the user's own voice
// laws.
//
// Why packs and not free-form text rules: the user typically doesn't
// know the exact phrasing of "MNPI" risk or "forward guidance" risk.
// Naming the pack is enough — we encode the operationalized rules.
//
// Packs are deliberately thin. Each rule has a code (matches the
// `rule` field in critic violations), a label (human-readable),
// detection guidance (what to look for), and a fix template. The
// critic uses guidance as part of its prompt; the panel uses label
// + the rule's color tier.
//
// To add a new pack: append to PACKS, register a frontend RULE_META
// entry for any new rule codes you introduce, ship.

const PUBLIC_COMPANY_EXEC = {
  id: 'public-company-exec',
  label: 'Public-company executive',
  description: 'For executives at SEC-registered companies. Forward guidance, material non-public information (MNPI), and selective disclosure risks.',
  rules: [
    {
      code: 'mnpi',
      label: 'Possible MNPI',
      severity: 'high',
      guidance: 'Specific revenue numbers, customer counts, deal sizes, churn metrics, headcount changes, or operational details that could move the stock if disclosed first to a non-public audience. Flag any specific quantitative business metric that would normally appear in an earnings call or 10-Q rather than a general post.',
      fix_template: 'Replace the specific number with directional language tied to a public source (e.g., "as we discussed in our last earnings call…").',
    },
    {
      code: 'forward-guidance',
      label: 'Forward guidance',
      severity: 'high',
      guidance: 'Statements about future revenue, growth rates, product launches with dates, customer pipeline, or earnings expectations. Anything that effectively re-prices the stock if read by a retail investor.',
      fix_template: 'Reframe as historical observation or hypothetical strategic discussion. Cut the specific timeline.',
    },
    {
      code: 'selective-disclosure',
      label: 'Selective disclosure',
      severity: 'medium',
      guidance: 'Sharing specific operational, financial, or strategic detail in a forum where some investors get access before others (e.g., a conference recap that includes data not in the public deck).',
      fix_template: 'Remove the unique-to-this-audience detail. If the detail is worth sharing, route it through Investor Relations first.',
    },
  ],
};

const REGULATED_PROFESSIONAL = {
  id: 'regulated-professional',
  label: 'Regulated profession (medical / legal / financial)',
  description: 'For professionals where statements can be construed as personalized advice, diagnosis, or guarantees.',
  rules: [
    {
      code: 'unsolicited-advice',
      label: 'Unsolicited specific advice',
      severity: 'high',
      guidance: 'Personalized recommendation directed at a reader\'s situation without an established professional relationship. ("If you have X symptoms, do Y." "If your case looks like Z, you should sue.")',
      fix_template: 'Reframe as general educational content. Add a clear "this is not advice for your situation" qualifier or remove the directive.',
    },
    {
      code: 'guarantee-language',
      label: 'Guarantee or outcome promise',
      severity: 'high',
      guidance: 'Explicit or implied guarantees of outcome ("you will recover", "you will win", "you will make money"). Even softened versions like "I always get my clients X" cross the line.',
      fix_template: 'Replace with descriptive observations of past patterns and explicit acknowledgment that outcomes vary.',
    },
    {
      code: 'professional-relationship-implied',
      label: 'Implied professional relationship',
      severity: 'medium',
      guidance: 'Language that could lead a reader to believe they have entered into a professional relationship with the writer based on the post alone (using "you" in a way that addresses an individual reader\'s case rather than a general audience).',
      fix_template: 'Switch to third-person or first-person plural framing. State explicitly that engagement is required for any individualized advice.',
    },
  ],
};

const POLITICAL_FIGURE = {
  id: 'political-figure',
  label: 'Political / public-office figure',
  description: 'For elected officials, candidates, or appointees. Conflict-of-interest signaling, official-vs-personal capacity, and donor-disclosure risks.',
  rules: [
    {
      code: 'capacity-ambiguity',
      label: 'Official-vs-personal ambiguity',
      severity: 'medium',
      guidance: 'Statements about policy positions, votes, or official actions where the post does not make clear whether the writer is speaking in their official capacity or personally. Particularly important when the topic touches active legislation or pending decisions.',
      fix_template: 'Add an explicit framing line ("personal view, not an official position" or "as your representative…") to remove the ambiguity.',
    },
    {
      code: 'donor-conflict',
      label: 'Donor conflict signal',
      severity: 'high',
      guidance: 'Endorsement of, or argumentation for, a specific company / sector / policy position where a financial relationship (donor, contract, board seat) exists and is not disclosed in the post itself.',
      fix_template: 'Disclose the relationship inline ("disclosure: [entity] has supported my campaigns / pays my [role]") or remove the endorsement.',
    },
  ],
};

const GENERIC = {
  id: 'generic',
  label: 'Generic operator (no compliance pack)',
  description: 'No additional compliance rules. Rigor critic uses universal rules + the writer\'s voice laws only. Default for most users.',
  rules: [],
};

const PACKS = [GENERIC, PUBLIC_COMPANY_EXEC, REGULATED_PROFESSIONAL, POLITICAL_FIGURE];

const PACK_BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));

/** Look up a pack by id; returns null when unknown or 'generic' (no rules). */
function getPack(id) {
  if (!id || id === 'generic') return null;
  return PACK_BY_ID[id] || null;
}

/**
 * Format the pack's rules as a critic-prompt fragment that drops in
 * alongside the universal rigor rules. Returns null when the pack has
 * no rules.
 */
function formatPackForCritic(pack) {
  if (!pack || !pack.rules || pack.rules.length === 0) return null;
  const lines = [];
  lines.push(`COMPLIANCE PACK — ${pack.label}:`);
  for (const rule of pack.rules) {
    lines.push(`- "${rule.code}" (severity ${rule.severity}): ${rule.guidance}`);
    lines.push(`    Fix template: ${rule.fix_template}`);
  }
  return lines.join('\n');
}

/** Public-API summary of all available packs. Used by the picker UI. */
function listPacks() {
  return PACKS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    rule_count: p.rules.length,
    rule_codes: p.rules.map((r) => r.code),
  }));
}

module.exports = {
  PACKS,
  getPack,
  formatPackForCritic,
  listPacks,
};

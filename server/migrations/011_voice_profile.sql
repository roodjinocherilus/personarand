-- Migration 011: Voice Profile.
--
-- The brand-voice document that drives every generation. Today this lives
-- as a hardcoded constant (BRAND_SYSTEM_PROMPT in server/lib/prompts.js)
-- shaped to Roodjino. To turn this product into a SaaS that other
-- executives can adopt, the voice document must become *data*: a
-- structured profile the user fills in (questionnaire), pastes from an
-- AI extraction prompt, or has the system extract from a corpus of their
-- past posts.
--
-- Schema choice: single row today (id = 1) so callers can read without
-- needing a user_id. When auth becomes multi-tenant, this migration
-- adds a NOT NULL user_id with a unique index — at which point the
-- existing row gets backfilled to the founding user. The shape of the
-- columns does not change, so per-user reads stay a one-line swap.
--
-- Dimensions (all weighted in scoring — see server/lib/voiceProfile.js):
--   core_thesis            — the central operating thesis (TEXT)
--   stand_for              — positions held openly (JSONB array of strings)
--   stand_against          — positions opposed openly (JSONB array of strings)
--   domains_of_authority   — JSONB array of { domain, why } pairs
--   frameworks             — JSONB array of named frameworks { name, description }
--   voice_laws             — JSONB array of style rules ("write in prose", "name the framework")
--   primary_audiences      — JSONB array of { audience, what_they_need }
--   anti_voice             — JSONB array of voices to avoid sounding like
--   strategic_horizon      — quarterly arc / yearly thesis (TEXT)
--   regional_context       — geographic or cultural anchoring (TEXT)
--
-- Score columns cache the last score run so the dashboard widget can
-- render instantly without re-spending Haiku tokens on every page load.
-- Score is recomputed when the user clicks "Re-score" or after a save
-- that changes any dimension.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS voice_profiles (
    id              SERIAL PRIMARY KEY,
    -- Single-row marker. Future multi-tenant migration replaces this
    -- with user_id NOT NULL UNIQUE.
    is_primary      BOOLEAN DEFAULT TRUE NOT NULL,

    -- Display name shown in UI ("Roodjino Chérilus", "Jane Doe").
    display_name    TEXT,

    -- Core dimensions.
    core_thesis             TEXT,
    stand_for               JSONB DEFAULT '[]'::jsonb,
    stand_against           JSONB DEFAULT '[]'::jsonb,
    domains_of_authority    JSONB DEFAULT '[]'::jsonb,
    frameworks              JSONB DEFAULT '[]'::jsonb,
    voice_laws              JSONB DEFAULT '[]'::jsonb,
    primary_audiences       JSONB DEFAULT '[]'::jsonb,
    anti_voice              JSONB DEFAULT '[]'::jsonb,
    strategic_horizon       TEXT,
    regional_context        TEXT,

    -- Provenance: how was this profile populated?
    --   'questionnaire' | 'ai-extraction' | 'corpus' | 'mixed' | 'default'
    source_mode             TEXT DEFAULT 'default',

    -- Cached score from last evaluation (0–100).
    score_total             INTEGER,
    -- Per-dimension breakdown: { dimension: { score: 0..100, weight: N, weighted: N, notes: '...' } }
    score_breakdown         JSONB,
    score_at                TIMESTAMPTZ,

    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure exactly one primary row exists so SELECT-with-LIMIT-1 patterns
-- in the route layer remain unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_profiles_primary
  ON voice_profiles(is_primary) WHERE is_primary = TRUE;

-- Bootstrap a single row so GET /api/voice-profile never 404s on a fresh
-- install. Empty fields render as "0% complete" in the UI, which is the
-- correct cold-start signal.
INSERT INTO voice_profiles (is_primary, source_mode)
SELECT TRUE, 'default'
WHERE NOT EXISTS (SELECT 1 FROM voice_profiles WHERE is_primary = TRUE);

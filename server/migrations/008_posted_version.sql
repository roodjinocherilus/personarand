-- Migration 008: Capture the edit delta — Roodjino's edits are training data.
--
-- The AI generates version A. The user edits it into version B before posting.
-- The difference is the sharpest voice signal we have — it's literally
-- "what does the AI get wrong that Roodjino has to fix?" Before now, that
-- information lived only in Roodjino's clipboard and never came back.
--
-- Semantics:
--   body              — the AI-generated content (EN)
--   posted_version_en — the final version that actually got posted (EN). NULL
--                       means we haven't collected it yet. Equal to `body`
--                       means user confirmed "posted as-is". Different means
--                       edits were made — THIS is the training signal.
--   body_fr, posted_version_fr — same pattern for French.
--   posted_at — when the 'posted' status was set (for future analytics).
--
-- Idempotent. Safe to re-run.

ALTER TABLE generated_content
  ADD COLUMN IF NOT EXISTS posted_version_en TEXT,
  ADD COLUMN IF NOT EXISTS posted_version_fr TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

-- Partial index: find the edits the AI should learn from. We only care about
-- cases where the user saved a version that differs from the AI's draft.
CREATE INDEX IF NOT EXISTS idx_generated_content_has_edits
  ON generated_content (posted_at DESC)
  WHERE posted_version_en IS NOT NULL AND posted_version_en != body;

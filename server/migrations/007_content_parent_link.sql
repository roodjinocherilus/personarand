-- Migration 007: Repurpose lineage
--
-- When you post a strong LinkedIn essay, one click should turn it into an X
-- thread, an IG caption, a newsletter paragraph, a YouTube hook. Each derivative
-- is its own generated_content row — but it's useful to know which post it came
-- from so the Library can show repurposing lineage and the feedback loop can
-- treat a family as one "piece" at the strategic level.
--
-- parent_content_id points a derivative back to its source.
-- Nullable — most rows have no parent (they are originals themselves).
-- ON DELETE SET NULL — deleting the parent doesn't cascade-kill derivatives.
--
-- Idempotent. Safe to re-run.

ALTER TABLE generated_content
  ADD COLUMN IF NOT EXISTS parent_content_id BIGINT REFERENCES generated_content(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_generated_content_parent
  ON generated_content (parent_content_id)
  WHERE parent_content_id IS NOT NULL;

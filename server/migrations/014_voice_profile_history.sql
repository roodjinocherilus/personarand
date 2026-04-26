-- Migration 014: Voice Profile change history.
--
-- Every save snapshots the prior state into voice_profile_versions
-- so the user can review past states and restore. Versions are
-- snapshot-only — they store the exact JSONB-encoded profile content
-- that was active at the time, with a `source_action` tag describing
-- why the snapshot was created.
--
-- Auto-prune retention is enforced in code (server keeps at most 50
-- per profile). 50 is enough to cover several months of editing for
-- the typical solo operator without unbounded growth.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS voice_profile_versions (
    id            SERIAL PRIMARY KEY,
    profile_id    INTEGER NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
    snapshot      JSONB NOT NULL,
    -- Tag describing what triggered the snapshot:
    --   'save'     — manual PUT
    --   'import'   — file import (replace semantics)
    --   'restore'  — a previous version was restored to this one
    --   'archetype'— archetype starter applied
    --   'corpus'   — corpus-extraction merge
    --   'ai'       — AI-extraction-prompt parse merge
    source_action TEXT DEFAULT 'save',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_profile_versions_profile_created
  ON voice_profile_versions (profile_id, created_at DESC);

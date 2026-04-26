-- Migration 012: Compliance pack on voice profile.
--
-- Pre-defined rule sets the user opts into based on their professional
-- context. The rigor critic flags violations specific to the pack in
-- addition to universal rigor rules and the user's own voice laws.
--
-- Pack definitions live in code (server/lib/compliancePacks.js) — the
-- column stores only the pack ID. Why: the rule wording will evolve;
-- storing it in code lets us update phrasing without a data migration,
-- and storing it as data invites users editing it incorrectly. Pack
-- IDs are stable; rule wording is not.
--
-- Idempotent.

ALTER TABLE voice_profiles
  ADD COLUMN IF NOT EXISTS compliance_pack TEXT;

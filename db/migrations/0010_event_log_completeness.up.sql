-- 0010_event_log_completeness — columns 0009 was missing.
--
-- 0009 was written from a partial reading of the record types and silently dropped
-- fields on the floor. The typechecker caught it when the writers were wired up. Each
-- column below exists because a real field had nowhere to go, and every one of them is
-- evidence that cannot be reconstructed after the fact.

/* ---------------------------------------------------------------- *
 * reviews — the verbatim texts, and the decision-time snapshots
 * ---------------------------------------------------------------- */

-- src/review.ts records `before` and `after` for an edit, and says why: `reply`
-- overwrites draft.body with the edited text, so without these the model's actual
-- output is destroyed the moment a human improves it. Two integers (charsBefore,
-- charsAfter) are not a substitute — "what do humans keep changing" needs the texts.
ALTER TABLE redbot.reviews ADD COLUMN edit_before text;
ALTER TABLE redbot.reviews ADD COLUMN edit_after  text;

COMMENT ON COLUMN redbot.reviews.edit_before IS
  'The generated draft, verbatim. reviews is append-only, so this is the durable copy — drafts.body can be edited again.';

-- Snapshots taken at decision time so a later threshold change cannot rewrite the
-- history of what the operator was actually looking at. Kept whole as jsonb: their
-- shapes are owned by quality.ts / gates.ts, not by this schema, and half-modelling
-- them here is what produced this migration in the first place.
ALTER TABLE redbot.reviews ADD COLUMN quality      jsonb;
ALTER TABLE redbot.reviews ADD COLUMN gates        jsonb;
ALTER TABLE redbot.reviews ADD COLUMN novelty      jsonb;
ALTER TABLE redbot.reviews ADD COLUMN contribution jsonb;

-- The edit trio must stay all-or-nothing now that the texts are part of it.
ALTER TABLE redbot.reviews DROP CONSTRAINT edit_metrics_only_for_edits;
ALTER TABLE redbot.reviews ADD  CONSTRAINT edit_metrics_only_for_edits CHECK (
  decision = 'edited'
  OR (edit_chars_before IS NULL AND edit_chars_after IS NULL AND edit_retained IS NULL
      AND edit_before IS NULL AND edit_after IS NULL)
);

/* ---------------------------------------------------------------- *
 * regret — who answered
 * ---------------------------------------------------------------- */

-- RegretRecord.operator. The regret answer is the one field in the evidence log a
-- machine cannot fill, so which person filled it is part of the record.
ALTER TABLE redbot.regret ADD COLUMN operator text;

/* ---------------------------------------------------------------- *
 * interactions — observation schema v1.0, in full
 * ---------------------------------------------------------------- */

-- ENGINE-FREEZE lists src/interactions.ts as frozen at observation schema v1.0.
-- Five of its fields had no column in 0009, which would have meant storing a v1.0
-- record as something less than v1.0 — a silent schema change to a frozen surface.

CREATE TYPE redbot.interaction_vector AS ENUM ('signed-in', 'signed-out', 'publish');

ALTER TABLE redbot.interactions ADD COLUMN vector redbot.interaction_vector;

-- ObservedThread / ObservedSelf / ObservedReply[] are nested observation payloads
-- whose shape is owned by the frozen module. jsonb keeps them byte-faithful; a
-- normalised copy here would be a second definition free to drift from the frozen one.
ALTER TABLE redbot.interactions ADD COLUMN thread  jsonb;
ALTER TABLE redbot.interactions ADD COLUMN self    jsonb;
ALTER TABLE redbot.interactions ADD COLUMN replies jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE redbot.interactions ADD COLUMN note    text  NOT NULL DEFAULT '';

COMMENT ON COLUMN redbot.interactions.self IS
  'What the account could see of its own reply. Null is meaningful: it means the reply was not found at all.';
COMMENT ON COLUMN redbot.interactions.vector IS
  'How the reading was taken. A signed-out reading is a different fact from a signed-in one.';

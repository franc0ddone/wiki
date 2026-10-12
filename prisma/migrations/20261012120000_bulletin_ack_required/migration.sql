-- Acknowledgement becomes opt-in at compose time (prompt 6e).
--
-- A notice now carries `ack_required` (default false). Existing notices that
-- already have at least one acknowledgement are backfilled to true, so nothing
-- that was already being tracked loses its Acknowledge control / rail marker.
ALTER TABLE "bulletins" ADD COLUMN     "ack_required" BOOLEAN NOT NULL DEFAULT false;

-- Backfill the notices that are already carrying acknowledgements.
UPDATE "bulletins"
SET "ack_required" = true
WHERE "id" IN (SELECT DISTINCT "bulletin_id" FROM "bulletin_acks");

\set ON_ERROR_STOP on

UPDATE api_key
SET token = 'pk_webmcp_phase1_medusa_evaluator'
WHERE type = 'publishable'
  AND deleted_at IS NULL;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM api_key
    WHERE token = 'pk_webmcp_phase1_medusa_evaluator'
      AND type = 'publishable'
      AND deleted_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one deterministic publishable key';
  END IF;
END
$$;

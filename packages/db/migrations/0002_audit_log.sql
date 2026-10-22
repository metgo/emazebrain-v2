-- eMazeBrain v2 — audit log (design doc §6, §10.5, §11.2).
--
-- Every write to a patient-data table is recorded by trigger, and the API
-- records reads (view / list / export) through app.record_audit(). Rows are
-- append-only and hash-chained: each row's hash covers the previous hash, so
-- any edit or deletion made outside the app (e.g. by a DBA with triggers
-- disabled) breaks the chain and app.verify_audit_chain() reports it.
-- Only column NAMES are logged, never values (no patient data in the log).

CREATE TABLE app.audit_event (
  id             uuid PRIMARY KEY DEFAULT app.uuidv7(),
  chain_seq      bigint NOT NULL UNIQUE,
  occurred_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_user_id  uuid,                 -- NULL = system / migration
  db_role        text NOT NULL DEFAULT current_user,
  clinic_id      uuid,
  patient_id     uuid,
  action         text NOT NULL CHECK (action IN (
                   'view', 'list', 'create', 'update', 'delete', 'export', 'print',
                   'sign', 'amend', 'login', 'login_failed', 'consent_change',
                   'permission_change', 'break_glass')),
  resource_type  text NOT NULL,
  resource_id    uuid,
  changed_fields text[],
  request_id     uuid,
  reason         text,
  prev_hash      bytea NOT NULL,
  hash           bytea NOT NULL
);
CREATE INDEX audit_patient_ix ON app.audit_event (patient_id, occurred_at) WHERE patient_id IS NOT NULL;
CREATE INDEX audit_actor_ix   ON app.audit_event (actor_user_id, occurred_at);
CREATE INDEX audit_clinic_ix  ON app.audit_event (clinic_id, occurred_at);

-- One row: the head of the chain. Locking it serialises appends (fine at MVP
-- volume; the design moves to one chain per monthly partition later).
CREATE TABLE app.audit_chain_head (
  id        boolean PRIMARY KEY DEFAULT true CHECK (id),
  chain_seq bigint NOT NULL,
  hash      bytea NOT NULL
);
INSERT INTO app.audit_chain_head (chain_seq, hash) VALUES (0, digest('emazebrain-audit-genesis', 'sha256'));

ALTER TABLE app.audit_event      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_event      FORCE ROW LEVEL SECURITY;
ALTER TABLE app.audit_chain_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_chain_head FORCE ROW LEVEL SECURITY;   -- no policies: invisible to the app

-- Users see their own actions; clinic managers see their clinic's events.
CREATE POLICY audit_own ON app.audit_event FOR SELECT
  USING (actor_user_id = app.current_user_id());
CREATE POLICY audit_clinic_manager ON app.audit_event FOR SELECT
  USING (clinic_id IS NOT NULL
         AND app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[]));

CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- Canonical text of a row's content, used for hashing.
CREATE OR REPLACE FUNCTION app.audit_canonical(e app.audit_event) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|', e.chain_seq, e.id, to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                   e.actor_user_id, e.db_role, e.clinic_id, e.patient_id, e.action, e.resource_type,
                   e.resource_id, array_to_string(e.changed_fields, ','), e.request_id, e.reason)
$$;

-- The only way to write an audit row. Runs with the definer's rights so the
-- app role never gets INSERT on the table, and the actor comes from the
-- session (app.user_id), never from the caller.
CREATE OR REPLACE FUNCTION app.record_audit(
  p_action text, p_resource_type text, p_resource_id uuid,
  p_patient_id uuid DEFAULT NULL, p_clinic_id uuid DEFAULT NULL,
  p_changed_fields text[] DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  head app.audit_chain_head;
  e    app.audit_event;
BEGIN
  SELECT * INTO head FROM app.audit_chain_head WHERE id FOR UPDATE;
  e.id             := app.uuidv7();
  e.chain_seq      := head.chain_seq + 1;
  e.occurred_at    := clock_timestamp();
  e.actor_user_id  := app.current_user_id();
  e.db_role        := session_user;
  e.clinic_id      := COALESCE(p_clinic_id, (SELECT clinic_id FROM app.patient WHERE id = p_patient_id));
  e.patient_id     := p_patient_id;
  e.action         := p_action;
  e.resource_type  := p_resource_type;
  e.resource_id    := p_resource_id;
  e.changed_fields := p_changed_fields;
  e.request_id     := nullif(current_setting('app.request_id', true), '')::uuid;
  e.reason         := p_reason;
  e.prev_hash      := head.hash;
  e.hash           := digest(head.hash || convert_to(app.audit_canonical(e), 'UTF8'), 'sha256');
  INSERT INTO app.audit_event VALUES (e.*);
  UPDATE app.audit_chain_head SET chain_seq = e.chain_seq, hash = e.hash WHERE id;
  RETURN e.id;
END $$;

-- Generic write trigger for patient-data tables: logs the action and the names
-- of the columns that changed. Each table says where its patient/clinic is.
CREATE OR REPLACE FUNCTION app.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  old_j  jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_j  jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  row_j  jsonb := COALESCE(new_j, old_j);
  fields text[];
  action text := CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
  rid    uuid;
  pid    uuid;
  cid    uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO fields
      FROM jsonb_object_keys(new_j) AS k
     WHERE new_j -> k IS DISTINCT FROM old_j -> k;
    IF fields IS NULL THEN RETURN NULL; END IF;     -- nothing actually changed
    IF 'deleted_at' = ANY (fields) AND new_j ->> 'deleted_at' IS NOT NULL THEN action := 'delete'; END IF;
  END IF;

  rid := CASE WHEN row_j ? 'id' THEN (row_j ->> 'id')::uuid END;
  pid := CASE TG_TABLE_NAME WHEN 'patient' THEN rid ELSE (row_j ->> 'patient_id')::uuid END;
  cid := (row_j ->> 'clinic_id')::uuid;
  IF TG_TABLE_NAME = 'consent' THEN action := 'consent_change'; END IF;
  IF TG_TABLE_NAME = 'membership' THEN action := 'permission_change'; END IF;

  PERFORM app.record_audit(action, TG_TABLE_NAME, rid, pid, cid, fields);
  RETURN NULL;
END $$;

CREATE TRIGGER audit_patient           AFTER INSERT OR UPDATE OR DELETE ON app.patient           FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_patient_care_team AFTER INSERT OR UPDATE OR DELETE ON app.patient_care_team FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_consent           AFTER INSERT                     ON app.consent           FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_membership        AFTER INSERT OR UPDATE OR DELETE ON app.membership        FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_clinic            AFTER INSERT OR UPDATE OR DELETE ON app.clinic            FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- Walks the chain; returns the chain_seq of every row whose hash doesn't verify.
CREATE OR REPLACE FUNCTION app.verify_audit_chain() RETURNS TABLE (broken_seq bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
  WITH ordered AS (
    SELECT e, lag(e.hash, 1, digest('emazebrain-audit-genesis', 'sha256')) OVER (ORDER BY e.chain_seq) AS expected_prev,
           lag(e.chain_seq, 1, 0::bigint) OVER (ORDER BY e.chain_seq) AS expected_seq
      FROM app.audit_event e
  )
  SELECT (e).chain_seq FROM ordered
   WHERE (e).prev_hash <> expected_prev
      OR (e).chain_seq <> expected_seq + 1
      OR (e).hash <> digest((e).prev_hash || convert_to(app.audit_canonical(e), 'UTF8'), 'sha256')
$$;

GRANT SELECT ON app.audit_event TO emb_app;
REVOKE INSERT, UPDATE, DELETE ON app.audit_event, app.audit_chain_head FROM emb_app;
REVOKE ALL ON app.audit_chain_head FROM emb_app;
GRANT EXECUTE ON FUNCTION app.record_audit(text, text, uuid, uuid, uuid, text[], text) TO emb_app;
REVOKE EXECUTE ON FUNCTION app.verify_audit_chain() FROM PUBLIC, emb_app;

-- 0005: patients you can actually manage — details, guardians, consent that
-- unlocks sessions, archiving (design doc §5.3, §6, §11.3). Expand-only.


-- ---------------------------------------------------------------- audit
-- updated_at is bookkeeping: don't list it as a changed field.
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
     WHERE new_j -> k IS DISTINCT FROM old_j -> k
       AND k <> 'updated_at';                      -- bookkeeping, not a change
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


-- ---------------------------------------------------------------- patient details
ALTER TABLE app.patient
  ADD COLUMN sex        text CHECK (sex IN ('female', 'male', 'other', 'undisclosed')),
  ADD COLUMN handedness text CHECK (handedness IN ('left', 'right', 'mixed')),
  -- Clinical or behavioural alert shown in the patient header and before a session.
  ADD COLUMN alert      text CHECK (char_length(alert) <= 500),
  -- Colour-vision deficiency: Catch Me If You Can switches to luminance-only contrast (§8.1).
  ADD COLUMN colour_vision_deficiency boolean NOT NULL DEFAULT false,
  ADD COLUMN created_by uuid REFERENCES app.app_user(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT patient_names_present CHECK (btrim(given_name) <> '' AND btrim(family_name) <> ''),
  ADD CONSTRAINT patient_dob_sane CHECK (date_of_birth > DATE '1900-01-01');

CREATE INDEX patient_clinic_name_ix ON app.patient (clinic_id, family_name, given_name);

-- Visibility: managers also see archived patients (so they can restore them);
-- therapists only see active records on their care team.
CREATE OR REPLACE FUNCTION app.can_see_patient(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.patient p
    WHERE p.id = p_patient
      AND (
        app.has_clinic_role(p.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
        OR (
          p.deleted_at IS NULL
          AND app.has_clinic_role(p.clinic_id, ARRAY['therapist', 'assistant']::app.member_role[])
          AND EXISTS (
            SELECT 1 FROM app.patient_care_team t
            WHERE t.patient_id = p.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
          )
        )
      )
  )
$$;

-- Only managers archive or restore (therapists "archive by request", §6), and
-- nobody moves a patient between clinics. updated_at is maintained here.
CREATE OR REPLACE FUNCTION app.patient_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN
    RAISE EXCEPTION 'a patient cannot move between clinics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND app.current_user_id() IS NOT NULL
     AND NOT app.has_clinic_role(OLD.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[]) THEN
    RAISE EXCEPTION 'only a clinic manager can archive or restore a patient' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER patient_guard BEFORE UPDATE ON app.patient FOR EACH ROW EXECUTE FUNCTION app.patient_guard();

-- Care team changes. The old policy looked the patient up under RLS, so a
-- therapist couldn't add herself to a patient she had just created. Now:
-- managers manage any team in their clinic; a team member can add colleagues;
-- and the creator of a brand-new patient (no team yet) can start the team.
-- Nobody else can add themselves to a patient they can't already see.
CREATE OR REPLACE FUNCTION app.can_manage_care_team(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.patient p
     WHERE p.id = p_patient AND p.deleted_at IS NULL
       AND (
         app.has_clinic_role(p.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
         OR (app.has_clinic_role(p.clinic_id, ARRAY['therapist']::app.member_role[]) AND app.can_see_patient(p.id))
         OR (p.created_by = app.current_user_id()
             AND app.has_clinic_role(p.clinic_id, ARRAY['therapist']::app.member_role[])
             AND NOT EXISTS (SELECT 1 FROM app.patient_care_team t WHERE t.patient_id = p.id))
       ))
$$;
ALTER FUNCTION app.can_manage_care_team(uuid) OWNER TO emb_rls_helper;

-- Team members must belong to the patient's clinic.
CREATE OR REPLACE FUNCTION app.is_clinic_staff(p_user uuid, p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.patient p JOIN app.membership m ON m.user_id = p_user AND m.status = 'active'
      LEFT JOIN app.clinic c ON c.id = p.clinic_id
     WHERE p.id = p_patient
       AND m.role IN ('clinic_manager', 'therapist', 'assistant', 'org_admin')
       AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id)))
$$;
ALTER FUNCTION app.is_clinic_staff(uuid, uuid) OWNER TO emb_rls_helper;

DROP POLICY care_team_manage ON app.patient_care_team;
CREATE POLICY care_team_manage ON app.patient_care_team FOR ALL
  USING (app.can_manage_care_team(patient_id))
  WITH CHECK (app.can_manage_care_team(patient_id) AND app.is_clinic_staff(user_id, patient_id));

-- Duplicate warning for "Add patient" (§5.3). Answers only yes/no, and only to
-- staff of that clinic, so it can't be used to read patients off the care team.
CREATE OR REPLACE FUNCTION app.patient_duplicate_exists(p_clinic uuid, p_given text, p_family text, p_dob date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.has_clinic_role(p_clinic, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[])
     AND EXISTS (
       SELECT 1 FROM app.patient p
        WHERE p.clinic_id = p_clinic AND p.deleted_at IS NULL AND p.date_of_birth = p_dob
          AND lower(btrim(p.given_name)) = lower(btrim(p_given))
          AND lower(btrim(p.family_name)) = lower(btrim(p_family)))
$$;
ALTER FUNCTION app.patient_duplicate_exists(uuid, text, text, date) OWNER TO emb_rls_helper;

-- ---------------------------------------------------------------- guardians
CREATE TABLE app.guardian (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  clinic_id        uuid NOT NULL REFERENCES app.clinic(id),
  user_id          uuid REFERENCES app.app_user(id),          -- set when they accept a portal invite
  full_name        text NOT NULL CHECK (btrim(full_name) <> ''),
  email            text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+$'),
  phone            text CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{6,20}$'),
  preferred_locale app.locale NOT NULL DEFAULT 'he',
  created_by       uuid REFERENCES app.app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX guardian_clinic_ix ON app.guardian (clinic_id) WHERE deleted_at IS NULL;

CREATE TABLE app.guardian_patient (
  guardian_id       uuid NOT NULL REFERENCES app.guardian(id),
  patient_id        uuid NOT NULL REFERENCES app.patient(id),
  relationship      text NOT NULL CHECK (relationship IN ('mother', 'father', 'parent', 'grandparent', 'legal_guardian', 'foster_parent', 'other')),
  is_legal_guardian boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_id, patient_id)
);
CREATE INDEX guardian_patient_patient_ix ON app.guardian_patient (patient_id);

-- A guardian is visible to staff who can see one of their children, to clinic
-- managers, and to whoever created the record (so it can be linked right away).
CREATE OR REPLACE FUNCTION app.can_see_guardian(p_guardian uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.guardian g
     WHERE g.id = p_guardian AND g.deleted_at IS NULL
       AND (
         app.has_clinic_role(g.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
         OR (g.created_by = app.current_user_id() AND app.has_clinic_role(g.clinic_id, enum_range(NULL::app.member_role)))
         OR EXISTS (SELECT 1 FROM app.guardian_patient gp WHERE gp.guardian_id = g.id AND app.can_see_patient(gp.patient_id))
       )
  )
$$;
GRANT SELECT ON app.guardian, app.guardian_patient TO emb_rls_helper;
ALTER FUNCTION app.can_see_guardian(uuid) OWNER TO emb_rls_helper;

ALTER TABLE app.guardian         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.guardian         FORCE ROW LEVEL SECURITY;
ALTER TABLE app.guardian_patient ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.guardian_patient FORCE ROW LEVEL SECURITY;

CREATE POLICY guardian_read ON app.guardian FOR SELECT USING (app.can_see_guardian(id));
CREATE POLICY guardian_insert ON app.guardian FOR INSERT
  WITH CHECK (created_by = app.current_user_id()
              AND app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[]));
CREATE POLICY guardian_update ON app.guardian FOR UPDATE
  USING (app.can_see_guardian(id))
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[]));

CREATE POLICY guardian_patient_read ON app.guardian_patient FOR SELECT USING (app.can_see_patient(patient_id));
CREATE POLICY guardian_patient_manage ON app.guardian_patient FOR ALL
  USING (app.can_see_patient(patient_id))
  WITH CHECK (app.can_see_patient(patient_id)
              AND EXISTS (SELECT 1 FROM app.guardian g JOIN app.patient p ON p.id = patient_id
                           WHERE g.id = guardian_id AND g.clinic_id = p.clinic_id));

GRANT SELECT, INSERT, UPDATE ON app.guardian TO emb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.guardian_patient TO emb_app;

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER guardian_touch BEFORE UPDATE ON app.guardian FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TRIGGER audit_guardian         AFTER INSERT OR UPDATE OR DELETE ON app.guardian         FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_guardian_patient AFTER INSERT OR UPDATE OR DELETE ON app.guardian_patient FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------- consent
-- Who gave it, in which language, and their typed name as the signature.
ALTER TABLE app.consent
  ADD COLUMN guardian_id uuid REFERENCES app.guardian(id),
  ADD COLUMN locale      app.locale,
  ADD COLUMN signer_name text CHECK (signer_name IS NULL OR btrim(signer_name) <> '');

-- The record hash is always computed by the database from the canonical
-- fields, so it can't be forged by the caller.
CREATE OR REPLACE FUNCTION app.consent_seal() RETURNS trigger LANGUAGE plpgsql
SET search_path = app, public, pg_temp AS $$
BEGIN
  NEW.signed_at := COALESCE(NEW.signed_at, now());
  NEW.record_hash := digest(convert_to(concat_ws('|',
      NEW.id, NEW.patient_id, NEW.guardian_id, NEW.purpose, NEW.decision, NEW.policy_version,
      NEW.method, NEW.locale, NEW.signer_name, to_char(NEW.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      NEW.captured_by), 'UTF8'), 'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER consent_seal BEFORE INSERT ON app.consent FOR EACH ROW EXECUTE FUNCTION app.consent_seal();

-- The signing guardian must be linked to this patient.
CREATE POLICY consent_guardian_linked ON app.consent AS RESTRICTIVE FOR INSERT
  WITH CHECK (guardian_id IS NULL
              OR EXISTS (SELECT 1 FROM app.guardian_patient gp WHERE gp.guardian_id = consent.guardian_id AND gp.patient_id = consent.patient_id));

-- Current decision per purpose (latest row wins).
CREATE VIEW app.consent_current WITH (security_invoker = true) AS
  SELECT DISTINCT ON (patient_id, purpose) *
    FROM app.consent
   ORDER BY patient_id, purpose, signed_at DESC, id DESC;
GRANT SELECT ON app.consent_current TO emb_app;

-- Consent for clinic sessions ("treatment" in the legal record) unlocks the
-- patient; withdrawing it locks them again. Sessions check status = 'active'.
CREATE OR REPLACE FUNCTION app.consent_apply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NEW.purpose = 'treatment' THEN
    IF NEW.decision = 'granted' THEN
      UPDATE app.patient SET status = 'active'
       WHERE id = NEW.patient_id AND status IN ('pending_consent', 'consent_legacy');
    ELSE
      UPDATE app.patient SET status = 'pending_consent'
       WHERE id = NEW.patient_id AND status = 'active';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER consent_apply AFTER INSERT ON app.consent FOR EACH ROW EXECUTE FUNCTION app.consent_apply();

-- Can this patient start a session? (used by the session runner, slice 4)
CREATE OR REPLACE FUNCTION app.patient_can_play(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.patient p
      JOIN app.consent_current c ON c.patient_id = p.id AND c.purpose = 'treatment' AND c.decision = 'granted'
     WHERE p.id = p_patient AND p.status = 'active' AND p.deleted_at IS NULL)
$$;

-- New functions are executable by PUBLIC by default; no blanket grant here, so
-- verify_audit_chain() stays out of the app role's reach.

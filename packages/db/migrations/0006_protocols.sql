-- 0006: protocols (design doc §5.4, §5.5). Templates hold ordered game steps;
-- assigning one to a patient copies the steps (so later template edits never
-- change a running protocol) and lays out a planned-session schedule.

-- ---------------------------------------------------------------- types
CREATE TYPE app.session_mode AS ENUM ('timed', 'lives', 'timed_lives');

-- ---------------------------------------------------------------- templates
CREATE TABLE app.protocol_template (
  id                uuid PRIMARY KEY DEFAULT app.uuidv7(),
  organization_id   uuid REFERENCES app.organization(id),     -- NULL = eMazeBrain platform library
  clinic_id         uuid REFERENCES app.clinic(id),           -- NULL = platform
  owner_user_id     uuid REFERENCES app.app_user(id),
  name              text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  description       text CHECK (char_length(description) <= 1000),
  weeks             smallint NOT NULL CHECK (weeks BETWEEN 1 AND 52),
  sessions_per_week smallint NOT NULL CHECK (sessions_per_week BETWEEN 1 AND 7),
  setting           text NOT NULL DEFAULT 'clinic' CHECK (setting IN ('clinic', 'home', 'mixed')),
  visibility        text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'clinic', 'platform')),
  version           integer NOT NULL DEFAULT 1,
  parent_template_id uuid REFERENCES app.protocol_template(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT template_scope CHECK ((visibility = 'platform') = (clinic_id IS NULL))
);
CREATE INDEX template_clinic_ix ON app.protocol_template (clinic_id) WHERE deleted_at IS NULL;

-- One step = one game with its settings. Mode decides which of duration and lives are set (§8.1).
CREATE TABLE app.template_step (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  template_id      uuid NOT NULL REFERENCES app.protocol_template(id) ON DELETE CASCADE,
  ordinal          smallint NOT NULL CHECK (ordinal >= 1),
  game_id          text NOT NULL,
  session_mode     app.session_mode NOT NULL,
  duration_s       integer CHECK (duration_s BETWEEN 30 AND 1800),
  lives            smallint CHECK (lives BETWEEN 1 AND 9),
  difficulty_start smallint NOT NULL DEFAULT 3 CHECK (difficulty_start BETWEEN 1 AND 5),
  hemisphere       text NOT NULL DEFAULT 'left' CHECK (hemisphere IN ('left', 'right')),
  timer_position   text NOT NULL DEFAULT 'left' CHECK (timer_position IN ('left', 'right', 'hidden')),
  practice         text NOT NULL DEFAULT 'auto' CHECK (practice IN ('auto', 'on', 'off')),
  trial_window_ms  integer CHECK (trial_window_ms BETWEEN 1000 AND 300000),
  game_params      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(game_params) = 'object'),
  progression      jsonb CHECK (progression IS NULL OR jsonb_typeof(progression) = 'object'),
  UNIQUE (template_id, ordinal) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT step_mode_fields CHECK (
    (session_mode = 'timed'       AND duration_s IS NOT NULL AND lives IS NULL) OR
    (session_mode = 'lives'       AND duration_s IS NULL     AND lives IS NOT NULL) OR
    (session_mode = 'timed_lives' AND duration_s IS NOT NULL AND lives IS NOT NULL))
);

CREATE OR REPLACE FUNCTION app.can_see_template(p_template uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.protocol_template t
     WHERE t.id = p_template AND t.deleted_at IS NULL
       AND (
         (t.visibility = 'platform' AND EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active'))
         OR (t.visibility = 'clinic' AND app.has_clinic_role(t.clinic_id, enum_range(NULL::app.member_role)))
         OR (t.owner_user_id = app.current_user_id() AND app.has_clinic_role(t.clinic_id, enum_range(NULL::app.member_role)))
         OR app.has_clinic_role(t.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
       ))
$$;

CREATE OR REPLACE FUNCTION app.can_edit_template(p_template uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.protocol_template t
     WHERE t.id = p_template AND t.deleted_at IS NULL AND t.clinic_id IS NOT NULL
       AND (
         (t.owner_user_id = app.current_user_id() AND app.has_clinic_role(t.clinic_id, ARRAY['therapist', 'clinic_manager', 'org_admin']::app.member_role[]))
         OR app.has_clinic_role(t.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
       ))
$$;
GRANT SELECT ON app.protocol_template TO emb_rls_helper;
ALTER FUNCTION app.can_see_template(uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.can_edit_template(uuid) OWNER TO emb_rls_helper;

ALTER TABLE app.protocol_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.protocol_template FORCE ROW LEVEL SECURITY;
ALTER TABLE app.template_step     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.template_step     FORCE ROW LEVEL SECURITY;

CREATE POLICY template_read ON app.protocol_template FOR SELECT USING (app.can_see_template(id) OR app.can_edit_template(id));
-- Staff create templates in their own clinic, owned by themselves. Platform templates come from the content pipeline only.
CREATE POLICY template_insert ON app.protocol_template FOR INSERT
  WITH CHECK (clinic_id IS NOT NULL AND owner_user_id = app.current_user_id() AND visibility IN ('private', 'clinic')
              AND app.has_clinic_role(clinic_id, ARRAY['therapist', 'clinic_manager', 'org_admin']::app.member_role[]));
CREATE POLICY template_update ON app.protocol_template FOR UPDATE
  USING (app.can_edit_template(id))
  WITH CHECK (clinic_id IS NOT NULL AND visibility IN ('private', 'clinic')
              AND app.has_clinic_role(clinic_id, ARRAY['therapist', 'clinic_manager', 'org_admin']::app.member_role[]));

CREATE POLICY template_step_read ON app.template_step FOR SELECT USING (app.can_see_template(template_id) OR app.can_edit_template(template_id));
CREATE POLICY template_step_write ON app.template_step FOR ALL
  USING (app.can_edit_template(template_id)) WITH CHECK (app.can_edit_template(template_id));

GRANT SELECT, INSERT, UPDATE ON app.protocol_template TO emb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.template_step TO emb_app;
CREATE TRIGGER template_touch BEFORE UPDATE ON app.protocol_template FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------- assignments
CREATE TABLE app.protocol_assignment (
  id                uuid PRIMARY KEY DEFAULT app.uuidv7(),
  patient_id        uuid NOT NULL REFERENCES app.patient(id),
  clinic_id         uuid NOT NULL REFERENCES app.clinic(id),
  template_id       uuid REFERENCES app.protocol_template(id),
  template_version  integer,
  assigned_by       uuid NOT NULL REFERENCES app.app_user(id),
  name              text NOT NULL CHECK (btrim(name) <> ''),
  start_date        date NOT NULL,
  weeks             smallint NOT NULL CHECK (weeks BETWEEN 1 AND 52),
  sessions_per_week smallint NOT NULL CHECK (sessions_per_week BETWEEN 1 AND 7),
  setting           text NOT NULL DEFAULT 'clinic' CHECK (setting IN ('clinic', 'home', 'mixed')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- One running protocol per patient at a time.
CREATE UNIQUE INDEX assignment_one_running_uq ON app.protocol_assignment (patient_id) WHERE status IN ('active', 'paused');
CREATE INDEX assignment_clinic_ix ON app.protocol_assignment (clinic_id, status);

-- The patient's own copy of each step, plus its live state (current difficulty moves with progression).
CREATE TABLE app.assignment_step (
  id                 uuid PRIMARY KEY DEFAULT app.uuidv7(),
  assignment_id      uuid NOT NULL REFERENCES app.protocol_assignment(id),
  patient_id         uuid NOT NULL REFERENCES app.patient(id),
  ordinal            smallint NOT NULL CHECK (ordinal >= 1),
  game_id            text NOT NULL,
  session_mode       app.session_mode NOT NULL,
  duration_s         integer CHECK (duration_s BETWEEN 30 AND 1800),
  lives              smallint CHECK (lives BETWEEN 1 AND 9),
  difficulty_start   smallint NOT NULL CHECK (difficulty_start BETWEEN 1 AND 5),
  current_difficulty smallint NOT NULL CHECK (current_difficulty BETWEEN 1 AND 5),
  hemisphere         text NOT NULL CHECK (hemisphere IN ('left', 'right')),
  timer_position     text NOT NULL CHECK (timer_position IN ('left', 'right', 'hidden')),
  practice           text NOT NULL CHECK (practice IN ('auto', 'on', 'off')),
  trial_window_ms    integer CHECK (trial_window_ms BETWEEN 1000 AND 300000),
  game_params        jsonb NOT NULL DEFAULT '{}',
  progression        jsonb,
  sessions_completed integer NOT NULL DEFAULT 0,
  UNIQUE (assignment_id, ordinal),
  CONSTRAINT astep_mode_fields CHECK (
    (session_mode = 'timed'       AND duration_s IS NOT NULL AND lives IS NULL) OR
    (session_mode = 'lives'       AND duration_s IS NULL     AND lives IS NOT NULL) OR
    (session_mode = 'timed_lives' AND duration_s IS NOT NULL AND lives IS NOT NULL))
);
CREATE INDEX assignment_step_assignment_ix ON app.assignment_step (assignment_id);

-- The schedule: one row per planned session (all steps run in order in each session).
CREATE TABLE app.planned_session (
  id            uuid PRIMARY KEY DEFAULT app.uuidv7(),
  assignment_id uuid NOT NULL REFERENCES app.protocol_assignment(id),
  patient_id    uuid NOT NULL REFERENCES app.patient(id),
  clinic_id     uuid NOT NULL REFERENCES app.clinic(id),
  seq           smallint NOT NULL CHECK (seq >= 1),
  week          smallint NOT NULL CHECK (week >= 1),
  planned_date  date NOT NULL,
  location      text NOT NULL DEFAULT 'clinic' CHECK (location IN ('clinic', 'home')),
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'done', 'missed', 'skipped', 'cancelled')),
  completed_at  timestamptz,
  UNIQUE (assignment_id, seq)
);
CREATE INDEX planned_session_day_ix ON app.planned_session (clinic_id, planned_date) WHERE status IN ('planned', 'in_progress');
CREATE INDEX planned_session_patient_ix ON app.planned_session (patient_id, planned_date);

-- Patient-scoped: the same visibility as the patient. Writes need a clinical role in the patient's clinic.
CREATE OR REPLACE FUNCTION app.can_treat_patient(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.can_see_patient(p_patient) AND EXISTS (
    SELECT 1 FROM app.patient p WHERE p.id = p_patient AND p.deleted_at IS NULL
      AND app.has_clinic_role(p.clinic_id, ARRAY['therapist', 'clinic_manager', 'org_admin']::app.member_role[]))
$$;
ALTER FUNCTION app.can_treat_patient(uuid) OWNER TO emb_rls_helper;

ALTER TABLE app.protocol_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.protocol_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_step     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_step     FORCE ROW LEVEL SECURITY;
ALTER TABLE app.planned_session     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.planned_session     FORCE ROW LEVEL SECURITY;

CREATE POLICY assignment_read  ON app.protocol_assignment FOR SELECT USING (app.can_see_patient(patient_id));
CREATE POLICY assignment_write ON app.protocol_assignment FOR INSERT
  WITH CHECK (app.can_treat_patient(patient_id) AND assigned_by = app.current_user_id()
              AND clinic_id = (SELECT p.clinic_id FROM app.patient p WHERE p.id = patient_id));
CREATE POLICY assignment_update ON app.protocol_assignment FOR UPDATE
  USING (app.can_treat_patient(patient_id)) WITH CHECK (app.can_treat_patient(patient_id));

CREATE POLICY astep_read  ON app.assignment_step FOR SELECT USING (app.can_see_patient(patient_id));
CREATE POLICY astep_write ON app.assignment_step FOR INSERT
  WITH CHECK (app.can_treat_patient(patient_id)
              AND EXISTS (SELECT 1 FROM app.protocol_assignment a WHERE a.id = assignment_id AND a.patient_id = assignment_step.patient_id));
CREATE POLICY astep_update ON app.assignment_step FOR UPDATE
  USING (app.can_treat_patient(patient_id)) WITH CHECK (app.can_treat_patient(patient_id));

CREATE POLICY psession_read  ON app.planned_session FOR SELECT USING (app.can_see_patient(patient_id));
CREATE POLICY psession_write ON app.planned_session FOR INSERT
  WITH CHECK (app.can_treat_patient(patient_id)
              AND EXISTS (SELECT 1 FROM app.protocol_assignment a WHERE a.id = assignment_id AND a.patient_id = planned_session.patient_id AND a.clinic_id = planned_session.clinic_id));
CREATE POLICY psession_update ON app.planned_session FOR UPDATE
  USING (app.can_treat_patient(patient_id)) WITH CHECK (app.can_treat_patient(patient_id));

GRANT SELECT, INSERT, UPDATE ON app.protocol_assignment, app.assignment_step, app.planned_session TO emb_app;
CREATE TRIGGER assignment_touch BEFORE UPDATE ON app.protocol_assignment FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TRIGGER audit_protocol_assignment AFTER INSERT OR UPDATE OR DELETE ON app.protocol_assignment FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_assignment_step     AFTER INSERT OR UPDATE OR DELETE ON app.assignment_step     FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_planned_session     AFTER UPDATE OR DELETE           ON app.planned_session     FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------- fix: colleagues' names
-- The 0001 policy looked up the colleague's memberships under RLS, which a
-- therapist can't read, so colleagues' names came back empty. A definer
-- helper answers "do we share a clinic?" without exposing memberships.
CREATE OR REPLACE FUNCTION app.shares_clinic_with(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.membership theirs
     WHERE theirs.user_id = p_user AND theirs.status = 'active' AND theirs.clinic_id IS NOT NULL
       AND app.has_clinic_role(theirs.clinic_id, enum_range(NULL::app.member_role)))
$$;
ALTER FUNCTION app.shares_clinic_with(uuid) OWNER TO emb_rls_helper;
DROP POLICY user_same_clinic ON app.app_user;
CREATE POLICY user_same_clinic ON app.app_user FOR SELECT USING (app.shares_clinic_with(id));

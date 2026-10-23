-- 0007: session results (design doc §5.6, §9.8, §10). Every upload attempt
-- is kept in session_result_raw (append-only). The device's UUIDv7
-- session_id is the idempotency key for game_session, so a result sent twice
-- is stored once. Progression decisions are logged with their inputs.

-- Every upload attempt, accepted or not. The app can write here but never read
-- or change it; support tooling reads it with a separate role.
CREATE TABLE app.session_result_raw (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  received_at      timestamptz NOT NULL DEFAULT now(),
  client_session_id uuid,
  planned_session_id uuid,
  patient_id       uuid,
  recorded_by      uuid NOT NULL REFERENCES app.app_user(id),
  envelope_version text,
  payload          jsonb NOT NULL,
  payload_sha256   bytea NOT NULL,
  outcome          text NOT NULL CHECK (outcome IN ('accepted', 'duplicate', 'conflict', 'rejected')),
  error            text
);
CREATE INDEX result_raw_session_ix ON app.session_result_raw (client_session_id);

-- One row per game played: the results the app and reports read.
CREATE TABLE app.game_session (
  id                 uuid PRIMARY KEY,                        -- device-generated UUIDv7
  patient_id         uuid NOT NULL REFERENCES app.patient(id),
  clinic_id          uuid NOT NULL REFERENCES app.clinic(id),
  assignment_step_id uuid REFERENCES app.assignment_step(id),
  planned_session_id uuid REFERENCES app.planned_session(id),
  recorded_by        uuid NOT NULL REFERENCES app.app_user(id),
  game_id            text NOT NULL,
  game_version       text NOT NULL,
  location           text NOT NULL DEFAULT 'clinic' CHECK (location IN ('clinic', 'home')),
  status             text NOT NULL CHECK (status IN ('completed', 'time_up', 'out_of_lives', 'abandoned')),
  end_reason         text NOT NULL,
  session_mode       app.session_mode NOT NULL,
  difficulty         smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  hemisphere         text NOT NULL CHECK (hemisphere IN ('left', 'right')),
  started_at         timestamptz,
  ended_at           timestamptz NOT NULL,
  active_ms          integer NOT NULL CHECK (active_ms >= 0),
  paused_ms          integer NOT NULL DEFAULT 0,
  lives_start        smallint,
  lives_lost         smallint NOT NULL DEFAULT 0,
  lives_remaining    smallint,
  trials_total       integer NOT NULL DEFAULT 0,
  correct            integer NOT NULL DEFAULT 0,
  errors             integer NOT NULL DEFAULT 0,
  timeouts           integer NOT NULL DEFAULT 0,
  accuracy           numeric(5,4) CHECK (accuracy BETWEEN 0 AND 1),
  rt_median_ms       integer,
  rt_mean_ms         integer,
  left_accuracy      numeric(5,4),
  right_accuracy     numeric(5,4),
  highest_level      smallint,
  levels_completed   smallint,
  metrics            jsonb NOT NULL DEFAULT '{}',
  std                jsonb NOT NULL DEFAULT '{}',
  levels             jsonb NOT NULL DEFAULT '[]',
  config_echo        jsonb NOT NULL DEFAULT '{}',
  is_valid           boolean NOT NULL DEFAULT true,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_session_uuidv7 CHECK (substring(id::text, 15, 1) = '7')
);
CREATE INDEX game_session_patient_ix ON app.game_session (patient_id, ended_at DESC);
CREATE INDEX game_session_step_ix ON app.game_session (assignment_step_id, ended_at DESC);
CREATE INDEX game_session_planned_ix ON app.game_session (planned_session_id);

-- Why difficulty changed (or didn't), with the numbers used. Append-only.
CREATE TABLE app.progression_decision (
  id                 uuid PRIMARY KEY DEFAULT app.uuidv7(),
  assignment_step_id uuid NOT NULL REFERENCES app.assignment_step(id),
  patient_id         uuid NOT NULL REFERENCES app.patient(id),
  game_session_id    uuid NOT NULL REFERENCES app.game_session(id),
  decided_at         timestamptz NOT NULL DEFAULT now(),
  action             text NOT NULL CHECK (action IN ('up', 'down', 'hold')),
  from_difficulty    smallint NOT NULL,
  to_difficulty      smallint NOT NULL,
  inputs             jsonb NOT NULL,
  reason             text NOT NULL
);
CREATE INDEX progression_step_ix ON app.progression_decision (assignment_step_id, decided_at);

ALTER TABLE app.session_result_raw   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.session_result_raw   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.game_session         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.game_session         FORCE ROW LEVEL SECURITY;
ALTER TABLE app.progression_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.progression_decision FORCE ROW LEVEL SECURITY;

-- Raw: any active staff member may record their own upload attempts; no one reads them through the app.
CREATE POLICY raw_insert ON app.session_result_raw FOR INSERT
  WITH CHECK (recorded_by = app.current_user_id()
              AND EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active'));

CREATE POLICY game_session_read ON app.game_session FOR SELECT USING (app.can_see_patient(patient_id));
CREATE POLICY game_session_insert ON app.game_session FOR INSERT
  WITH CHECK (recorded_by = app.current_user_id() AND app.can_treat_patient(patient_id)
              AND clinic_id = (SELECT p.clinic_id FROM app.patient p WHERE p.id = patient_id));

CREATE POLICY progression_read ON app.progression_decision FOR SELECT USING (app.can_see_patient(patient_id));
CREATE POLICY progression_insert ON app.progression_decision FOR INSERT WITH CHECK (app.can_treat_patient(patient_id));

GRANT INSERT ON app.session_result_raw TO emb_app;
REVOKE SELECT, UPDATE ON app.session_result_raw FROM emb_app;
GRANT SELECT, INSERT ON app.game_session, app.progression_decision TO emb_app;
REVOKE UPDATE ON app.game_session, app.progression_decision FROM emb_app;

-- Append-only, for everyone (CLAUDE.md invariant 4).
CREATE TRIGGER session_result_raw_append_only BEFORE UPDATE OR DELETE ON app.session_result_raw FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER progression_append_only        BEFORE UPDATE OR DELETE ON app.progression_decision FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER game_session_no_delete         BEFORE DELETE ON app.game_session FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

CREATE TRIGGER audit_game_session         AFTER INSERT ON app.game_session         FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_progression_decision AFTER INSERT ON app.progression_decision FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

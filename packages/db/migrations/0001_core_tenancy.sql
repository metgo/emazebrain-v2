-- eMazeBrain v2 — core tenancy, patients and consent, with row-level security.
-- Design doc §6 (roles), §10 (data model). Expand/contract migrations only.
--
-- The application connects as role `emb_app` (no BYPASSRLS) and sets, per
-- transaction:   SET LOCAL app.user_id = '<uuid>';
-- Every tenant table has FORCE ROW LEVEL SECURITY, and a CI test fails if a
-- new table in schema `app` is missing it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------- roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emb_app') THEN
    CREATE ROLE emb_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- ---------------------------------------------------------------- uuidv7
-- Time-ordered UUIDs (RFC 9562). Postgres 18 ships uuidv7(); this covers 16/17.
CREATE OR REPLACE FUNCTION app.uuidv7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ts_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  bytes bytea := gen_random_bytes(16);
BEGIN
  bytes := set_byte(bytes, 0, ((ts_ms >> 40) & 255)::int);
  bytes := set_byte(bytes, 1, ((ts_ms >> 32) & 255)::int);
  bytes := set_byte(bytes, 2, ((ts_ms >> 24) & 255)::int);
  bytes := set_byte(bytes, 3, ((ts_ms >> 16) & 255)::int);
  bytes := set_byte(bytes, 4, ((ts_ms >> 8) & 255)::int);
  bytes := set_byte(bytes, 5, (ts_ms & 255)::int);
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);  -- version 7
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);  -- variant 10
  RETURN encode(bytes, 'hex')::uuid;
END $$;

-- ---------------------------------------------------------------- types
CREATE TYPE app.region AS ENUM ('il', 'us', 'eu');
CREATE TYPE app.member_role AS ENUM ('platform_admin', 'org_admin', 'clinic_manager', 'therapist', 'assistant');
CREATE TYPE app.locale AS ENUM ('he', 'en', 'ar', 'ru', 'fr', 'es', 'zh');

-- ---------------------------------------------------------------- tables
CREATE TABLE app.organization (
  id            uuid PRIMARY KEY DEFAULT app.uuidv7(),
  name          text NOT NULL,
  region        app.region NOT NULL,
  default_locale app.locale NOT NULL DEFAULT 'he',
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE app.clinic (
  id              uuid PRIMARY KEY DEFAULT app.uuidv7(),
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  name            text NOT NULL,
  country_code    char(2) NOT NULL,
  timezone        text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX clinic_org_name_uq ON app.clinic (organization_id, name) WHERE deleted_at IS NULL;

CREATE TABLE app.app_user (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  email            text NOT NULL,
  full_name        text NOT NULL,
  preferred_locale app.locale NOT NULL DEFAULT 'he',
  kind             text NOT NULL CHECK (kind IN ('staff', 'guardian')),
  status           text NOT NULL DEFAULT 'invited' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE UNIQUE INDEX app_user_email_uq ON app.app_user (lower(email)) WHERE deleted_at IS NULL;

-- One row per user × clinic × role; multi-clinic therapists hold several rows.
CREATE TABLE app.membership (
  id              uuid PRIMARY KEY DEFAULT app.uuidv7(),
  user_id         uuid NOT NULL REFERENCES app.app_user(id),
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  clinic_id       uuid REFERENCES app.clinic(id),           -- NULL = organization-wide
  role            app.member_role NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'revoked')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX membership_uq ON app.membership (user_id, clinic_id, role) WHERE status <> 'revoked';
CREATE INDEX membership_clinic_ix ON app.membership (clinic_id, role);

CREATE TABLE app.patient (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  clinic_id        uuid NOT NULL REFERENCES app.clinic(id),
  given_name       text NOT NULL,
  family_name      text NOT NULL,
  date_of_birth    date NOT NULL,
  preferred_locale app.locale NOT NULL DEFAULT 'he',
  status           text NOT NULL DEFAULT 'pending_consent'
                   CHECK (status IN ('pending_consent', 'consent_legacy', 'active', 'inactive', 'discharged')),
  intake_source    text NOT NULL DEFAULT 'admin_created' CHECK (intake_source IN ('admin_created', 'self_registered', 'migrated')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX patient_clinic_status_ix ON app.patient (clinic_id, status) WHERE deleted_at IS NULL;

CREATE TABLE app.patient_care_team (
  patient_id  uuid NOT NULL REFERENCES app.patient(id),
  user_id     uuid NOT NULL REFERENCES app.app_user(id),
  role        text NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'secondary', 'assistant')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  PRIMARY KEY (patient_id, user_id, role)
);
CREATE INDEX care_team_user_ix ON app.patient_care_team (user_id) WHERE ended_at IS NULL;

-- Append-only: the latest row per (patient, purpose) is the current decision.
CREATE TABLE app.consent (
  id             uuid PRIMARY KEY DEFAULT app.uuidv7(),
  patient_id     uuid NOT NULL REFERENCES app.patient(id),
  purpose        text NOT NULL CHECK (purpose IN ('treatment', 'home_program', 'messaging', 'research_deidentified')),
  decision       text NOT NULL CHECK (decision IN ('granted', 'withdrawn')),
  policy_version text NOT NULL,
  method         text NOT NULL CHECK (method IN ('in_clinic_esign', 'remote_signed_form', 'remote_card', 'remote_id_check')),
  signed_at      timestamptz NOT NULL DEFAULT now(),
  captured_by    uuid NOT NULL REFERENCES app.app_user(id),
  record_hash    bytea NOT NULL
);
CREATE INDEX consent_patient_ix ON app.consent (patient_id, purpose, signed_at DESC);

-- ---------------------------------------------------------------- helpers
-- SECURITY DEFINER so policies can look at membership/care-team rows the
-- caller can't select directly. search_path is pinned to avoid hijacking.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.has_clinic_role(p_clinic uuid, p_roles app.member_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.membership m
    LEFT JOIN app.clinic c ON c.id = p_clinic
    WHERE m.user_id = app.current_user_id()
      AND m.status = 'active'
      AND m.role = ANY (p_roles)
      AND (m.clinic_id = p_clinic OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_see_patient(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.patient p
    WHERE p.id = p_patient
      AND p.deleted_at IS NULL
      AND (
        app.has_clinic_role(p.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
        OR (
          app.has_clinic_role(p.clinic_id, ARRAY['therapist', 'assistant']::app.member_role[])
          AND EXISTS (
            SELECT 1 FROM app.patient_care_team t
            WHERE t.patient_id = p.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
          )
        )
      )
  )
$$;

-- ---------------------------------------------------------------- RLS
ALTER TABLE app.organization      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clinic            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.app_user          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membership        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patient           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patient_care_team ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.consent           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization      FORCE ROW LEVEL SECURITY;
ALTER TABLE app.clinic            FORCE ROW LEVEL SECURITY;
ALTER TABLE app.app_user          FORCE ROW LEVEL SECURITY;
ALTER TABLE app.membership        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.patient           FORCE ROW LEVEL SECURITY;
ALTER TABLE app.patient_care_team FORCE ROW LEVEL SECURITY;
ALTER TABLE app.consent           FORCE ROW LEVEL SECURITY;

CREATE POLICY org_member_read ON app.organization FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.clinic c WHERE c.organization_id = organization.id
                 AND app.has_clinic_role(c.id, enum_range(NULL::app.member_role))));

CREATE POLICY clinic_member_read ON app.clinic FOR SELECT
  USING (app.has_clinic_role(id, enum_range(NULL::app.member_role)));
CREATE POLICY clinic_manager_update ON app.clinic FOR UPDATE
  USING (app.has_clinic_role(id, ARRAY['clinic_manager', 'org_admin']::app.member_role[]));

CREATE POLICY user_self ON app.app_user FOR SELECT
  USING (id = app.current_user_id());
CREATE POLICY user_same_clinic ON app.app_user FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app_user.id AND m.status = 'active'
                 AND m.clinic_id IS NOT NULL AND app.has_clinic_role(m.clinic_id, enum_range(NULL::app.member_role))));

CREATE POLICY membership_own ON app.membership FOR SELECT
  USING (user_id = app.current_user_id());
CREATE POLICY membership_manager ON app.membership FOR ALL
  USING (clinic_id IS NOT NULL AND app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[]))
  WITH CHECK (clinic_id IS NOT NULL
              AND app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
              AND role NOT IN ('platform_admin', 'org_admin', 'clinic_manager'));  -- can't grant ≥ own role

CREATE POLICY patient_read ON app.patient FOR SELECT
  USING (app.can_see_patient(id));
CREATE POLICY patient_insert ON app.patient FOR INSERT
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[]));
CREATE POLICY patient_update ON app.patient FOR UPDATE
  USING (app.can_see_patient(id))
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[]));
-- No DELETE policy: patients are archived (deleted_at), never hard-deleted by the app.

CREATE POLICY care_team_read ON app.patient_care_team FOR SELECT
  USING (app.can_see_patient(patient_id));
CREATE POLICY care_team_manage ON app.patient_care_team FOR ALL
  USING (EXISTS (SELECT 1 FROM app.patient p WHERE p.id = patient_id
                 AND app.has_clinic_role(p.clinic_id, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[])))
  WITH CHECK (EXISTS (SELECT 1 FROM app.patient p WHERE p.id = patient_id
                 AND app.has_clinic_role(p.clinic_id, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[])));

CREATE POLICY consent_read ON app.consent FOR SELECT
  USING (app.can_see_patient(patient_id));
CREATE POLICY consent_insert ON app.consent FOR INSERT
  WITH CHECK (app.can_see_patient(patient_id) AND captured_by = app.current_user_id());

-- Append-only: block UPDATE and DELETE for everyone, including table owners.
CREATE OR REPLACE FUNCTION app.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER consent_append_only BEFORE UPDATE OR DELETE ON app.consent
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- ---------------------------------------------------------------- helper owner
-- The policy helpers read membership/care-team rows that are themselves under
-- RLS. They run as a dedicated NOLOGIN role that bypasses RLS, so policies
-- never recurse and the app role itself never bypasses anything.
-- [Open] confirm Amazon RDS allows BYPASSRLS on a NOLOGIN role created by rds_superuser.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emb_rls_helper') THEN
    CREATE ROLE emb_rls_helper NOLOGIN BYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA app TO emb_rls_helper;
GRANT SELECT ON app.membership, app.clinic, app.patient, app.patient_care_team TO emb_rls_helper;
ALTER FUNCTION app.has_clinic_role(uuid, app.member_role[]) OWNER TO emb_rls_helper;
ALTER FUNCTION app.can_see_patient(uuid) OWNER TO emb_rls_helper;

-- ---------------------------------------------------------------- grants
GRANT USAGE ON SCHEMA app TO emb_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO emb_app;
REVOKE UPDATE ON app.consent FROM emb_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO emb_app;

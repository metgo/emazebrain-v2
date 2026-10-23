-- 0004: refuse a two-step sign-in code that was already used (ADR 0004, open item).
-- TOTP codes are valid for a 30-second step (Better Auth also accepts ±1 step), so a code
-- seen in the last 120 seconds is claimed and cannot be used again.
-- Lives in schema `auth`, which the app role cannot read; written only by the
-- API's auth service connection.

CREATE TABLE auth.totp_claim (
  user_id    text        NOT NULL,
  code       text        NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);
CREATE INDEX totp_claim_claimed_at_ix ON auth.totp_claim (claimed_at);

-- Atomically claims (user, code). Returns false if the same code was claimed
-- in the last 90 seconds, so two requests racing with one code can't both pass.
CREATE OR REPLACE FUNCTION auth.claim_totp(p_user text, p_code text) RETURNS boolean
LANGUAGE sql VOLATILE AS $$
  WITH claimed AS (
    INSERT INTO auth.totp_claim AS t (user_id, code) VALUES (p_user, p_code)
    ON CONFLICT (user_id, code) DO UPDATE SET claimed_at = now()
      WHERE t.claimed_at < now() - interval '120 seconds'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;
REVOKE ALL ON FUNCTION auth.claim_totp(text, text) FROM PUBLIC;

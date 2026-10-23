/**
 * Slice 1 through the API: add a patient, warn on duplicates, link a
 * guardian, record consent (which unlocks sessions), archive and restore.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("patients, guardians and consent API", () => {
  let env: TestEnv;
  let yael: Api;
  let dana: Api;
  let ronit: Api;
  let ids: Awaited<ReturnType<typeof seedClinics>> & { yael: string; dana: string; ronit: string };
  let patientId = "";
  let guardianId = "";

  beforeAll(async () => {
    env = await setupApi();
    const clinics = await seedClinics(env.db);
    const y = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    const d = await staffClient(env, "dana@synthetic.test", "Dana Kaplan");
    const r = await staffClient(env, "ronit@synthetic.test", "Ronit Manager");
    yael = y.api;
    dana = d.api;
    ronit = r.api;
    ids = { ...clinics, yael: y.userId, dana: d.userId, ronit: r.userId };
    await addMember(env.db, ids.yael, ids.org, ids.clinic, "therapist");
    await addMember(env.db, ids.dana, ids.org, ids.clinic, "therapist");
    await addMember(env.db, ids.ronit, ids.org, ids.clinic, "clinic_manager");
  });
  afterAll(async () => env?.close());

  const newPatient = (extra: Record<string, unknown> = {}) => ({
    clinic_id: ids.clinic,
    given_name: "Noa",
    family_name: "Levi",
    date_of_birth: "2018-03-01",
    preferred_locale: "he",
    ...extra,
  });

  it("adds a patient who waits for consent, on the creator's caseload", async () => {
    const res = await yael("/v1/patients", { method: "POST", body: newPatient({ alert: "Sensitive to loud sounds" }) });
    expect(res.status).toBe(201);
    patientId = res.body.id;
    const { body } = await yael(`/v1/patients/${patientId}`);
    expect(body.patient).toMatchObject({
      given_name: "Noa",
      status: "pending_consent",
      can_play: false,
      alert: "Sensitive to loud sounds",
      care_team: [{ user_id: ids.yael, full_name: "Yael Bar", role: "primary" }],
      guardians: [],
      consents: [],
    });
    expect((await dana(`/v1/patients/${patientId}`)).status).toBe(404);
  });

  it("rejects bad input field by field", async () => {
    const res = await yael("/v1/patients", { method: "POST", body: newPatient({ given_name: " ", date_of_birth: "2030-01-01", preferred_locale: "xx" }) });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(["date_of_birth", "given_name", "preferred_locale"]);
  });

  it("warns before adding the same child twice, then allows it if asked", async () => {
    const dup = await dana("/v1/patients", { method: "POST", body: newPatient({ given_name: "noa " }) });
    expect(dup).toEqual({ status: 409, body: { error: "possible_duplicate" } });
    const anyway = await dana("/v1/patients", { method: "POST", body: newPatient({ allow_duplicate: true, date_of_birth: "2018-03-01" }) });
    expect(anyway.status).toBe(201);
  });

  it("lets a manager assign the primary therapist, but not a therapist", async () => {
    expect((await yael("/v1/patients", { method: "POST", body: newPatient({ given_name: "Maya", therapist_id: ids.dana }) })).status).toBe(403);
    const res = await ronit("/v1/patients", { method: "POST", body: newPatient({ given_name: "Maya", therapist_id: ids.dana }) });
    expect(res.status).toBe(201);
    expect((await dana(`/v1/patients/${res.body.id}`)).body.patient.care_team[0].user_id).toBe(ids.dana);
    const staff = await ronit(`/v1/clinics/${ids.clinic}/staff`);
    expect(staff.body.staff.map((s: { full_name: string }) => s.full_name)).toEqual(["Dana Kaplan", "Ronit Manager", "Yael Bar"]);
  });

  it("cannot add a patient to a clinic the user doesn't work in", async () => {
    expect((await yael("/v1/patients", { method: "POST", body: newPatient({ clinic_id: ids.other, given_name: "Omer" }) })).status).toBe(403);
  });

  it("edits details; therapists can't archive", async () => {
    const res = await yael(`/v1/patients/${patientId}`, { method: "PATCH", body: { handedness: "left", colour_vision_deficiency: true, alert: "" } });
    expect(res.body.patient).toMatchObject({ handedness: "left", colour_vision_deficiency: true, alert: null });
    expect((await yael(`/v1/patients/${patientId}/archive`, { method: "POST", body: {} })).status).toBe(403);
  });

  it("links a guardian and records consent, which unlocks sessions", async () => {
    const g = await yael(`/v1/patients/${patientId}/guardians`, {
      method: "POST",
      body: { full_name: "Miri Levi", relationship: "mother", is_legal_guardian: true, phone: "+972 50 000 0000", preferred_locale: "he" },
    });
    expect(g.status).toBe(201);
    guardianId = g.body.id;

    const consent = await yael(`/v1/patients/${patientId}/consents`, {
      method: "POST",
      body: { guardian_id: guardianId, signer_name: "Miri Levi", locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "withdrawn" } },
    });
    expect(consent.status).toBe(201);
    expect(consent.body.patient).toMatchObject({ status: "active", can_play: true });
    expect(consent.body.patient.consents.map((c: { purpose: string; decision: string }) => `${c.purpose}:${c.decision}`).sort()).toEqual([
      "home_program:granted",
      "research_deidentified:withdrawn",
      "treatment:granted",
    ]);
    expect(consent.body.patient.guardians[0]).toMatchObject({ full_name: "Miri Levi", relationship: "mother" });
  });

  it("only a legal guardian can sign", async () => {
    const g = await yael(`/v1/patients/${patientId}/guardians`, {
      method: "POST",
      body: { full_name: "Savta Levi", relationship: "grandparent", is_legal_guardian: false, preferred_locale: "he" },
    });
    const res = await yael(`/v1/patients/${patientId}/consents`, {
      method: "POST",
      body: { guardian_id: g.body.id, signer_name: "Savta Levi", locale: "he", decisions: { messaging: "granted" } },
    });
    expect(res).toEqual({ status: 422, body: { error: "not_legal_guardian" } });
  });

  it("withdrawing consent for clinic sessions locks sessions again, and history is kept", async () => {
    const res = await yael(`/v1/patients/${patientId}/consents`, {
      method: "POST",
      body: { guardian_id: guardianId, signer_name: "Miri Levi", locale: "he", decisions: { treatment: "withdrawn" } },
    });
    expect(res.body.patient).toMatchObject({ status: "pending_consent", can_play: false });
    const history = await yael(`/v1/patients/${patientId}/consents`);
    expect(history.body.consents.filter((c: { purpose: string }) => c.purpose === "treatment").map((c: { decision: string }) => c.decision)).toEqual(["withdrawn", "granted"]);
    // Asking for "active" without consent leaves the patient waiting for it.
    expect((await yael(`/v1/patients/${patientId}`, { method: "PATCH", body: { status: "active" } })).body.patient.status).toBe("pending_consent");
  });

  it("a manager archives and restores; archived patients leave the therapist's list", async () => {
    expect((await ronit(`/v1/patients/${patientId}/archive`, { method: "POST", body: {} })).status).toBe(200);
    expect((await yael(`/v1/patients?clinic=${ids.clinic}`)).body.patients.map((p: { id: string }) => p.id)).not.toContain(patientId);
    const archived = await ronit(`/v1/patients?clinic=${ids.clinic}&archived=1`);
    expect(archived.body.patients.map((p: { id: string }) => p.id)).toEqual([patientId]);
    expect((await ronit(`/v1/patients/${patientId}/restore`, { method: "POST", body: {} })).status).toBe(200);
    expect((await yael(`/v1/patients/${patientId}`)).status).toBe(200);
  });

  it("writes every change to the audit log, without values", async () => {
    const { rows } = await env.db.query(
      `SELECT action, resource_type, changed_fields FROM app.audit_event WHERE patient_id = $1 AND action <> 'view' ORDER BY chain_seq`,
      [patientId],
    );
    const kinds = rows.map((r) => `${r.action}:${r.resource_type}`);
    expect(kinds).toContain("create:patient");
    expect(kinds).toContain("consent_change:consent");
    expect(kinds).toContain("delete:patient");
    expect(JSON.stringify(rows)).not.toContain("Sensitive to loud sounds");
    expect(JSON.stringify(rows)).not.toContain("Miri");
  });
});

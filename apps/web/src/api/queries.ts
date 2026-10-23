import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePatient,
  GuardianInput,
  PatientDetail,
  PatientListItem,
  PatientStatus,
  RecordConsent,
  StaffMember,
  UpdatePatient,
} from "@emb/contracts";
import { ApiError, apiGet, apiSend } from "./http.ts";
import type { AssignInput, AssignmentView, TemplateDetail, TemplateInput, TemplateSummary, TodayItem } from "@emb/contracts";

export type { PatientDetail, PatientListItem, PatientStatus, StaffMember };
export type Role = "platform_admin" | "org_admin" | "clinic_manager" | "therapist" | "assistant";
export interface Membership {
  clinic_id: string | null;
  organization_id: string;
  role: Role;
  clinic_name: string | null;
}
export interface Me {
  user: { id: string; email: string; name: string };
  memberships: Membership[];
}
/** Kept for older screens: the list row. */
export type PatientRow = PatientListItem;

/** Don't retry answers that won't change: signed out, MFA missing, not found. */
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;

export const meKey = ["me"] as const;
export const patientKey = (id: string) => ["patient", id] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: ({ signal }) => apiGet<Me>("/v1/me", { signal }), retry, staleTime: 60_000 });
}

export function usePatients(clinicId: string | null, archived = false) {
  return useQuery({
    queryKey: ["patients", clinicId, archived],
    queryFn: ({ signal }) => {
      const q = new URLSearchParams();
      if (clinicId) q.set("clinic", clinicId);
      if (archived) q.set("archived", "1");
      const qs = q.toString();
      return apiGet<{ patients: PatientListItem[] }>(`/v1/patients${qs ? `?${qs}` : ""}`, { signal }).then((r) => r.patients);
    },
    retry,
  });
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: patientKey(id),
    queryFn: ({ signal }) => apiGet<{ patient: PatientDetail }>(`/v1/patients/${encodeURIComponent(id)}`, { signal }).then((r) => r.patient),
    retry,
  });
}

export function useStaff(clinicId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["staff", clinicId],
    queryFn: ({ signal }) => apiGet<{ staff: StaffMember[] }>(`/v1/clinics/${clinicId}/staff`, { signal }).then((r) => r.staff),
    enabled: enabled && !!clinicId,
    retry,
    staleTime: 60_000,
  });
}

/** After any patient change: refresh lists and this patient. */
function useRefresh(id?: string) {
  const qc = useQueryClient();
  return (patient?: PatientDetail) => {
    void qc.invalidateQueries({ queryKey: ["patients"] });
    if (id && patient) qc.setQueryData(patientKey(id), patient);
    else if (id) void qc.invalidateQueries({ queryKey: patientKey(id) });
  };
}

export function useCreatePatient() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: CreatePatient) => apiSend<{ id: string }>("POST", "/v1/patients", body),
    onSuccess: () => refresh(),
  });
}

export function useUpdatePatient(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (body: UpdatePatient) => apiSend<{ patient: PatientDetail }>("PATCH", `/v1/patients/${id}`, body).then((r) => r.patient),
    onSuccess: (p) => refresh(p),
  });
}

export function useArchivePatient(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (archive: boolean) => apiSend<{ ok: true }>("POST", `/v1/patients/${id}/${archive ? "archive" : "restore"}`),
    onSuccess: () => refresh(),
  });
}

export function useSaveGuardian(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: ({ guardianId, body }: { guardianId?: string; body: GuardianInput }): Promise<unknown> =>
      guardianId
        ? apiSend<{ ok: true }>("PATCH", `/v1/patients/${patientId}/guardians/${guardianId}`, body)
        : apiSend<{ id: string }>("POST", `/v1/patients/${patientId}/guardians`, body),
    onSuccess: () => refresh(),
  });
}

export function useRemoveGuardian(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (guardianId: string) => apiSend<{ ok: true }>("DELETE", `/v1/patients/${patientId}/guardians/${guardianId}`),
    onSuccess: () => refresh(),
  });
}

export function useRecordConsent(patientId: string) {
  const refresh = useRefresh(patientId);
  return useMutation({
    mutationFn: (body: RecordConsent) => apiSend<{ patient: PatientDetail }>("POST", `/v1/patients/${patientId}/consents`, body).then((r) => r.patient),
    onSuccess: (p) => refresh(p),
  });
}

// ---------------------------------------------------------------- protocols (slice 3)
export type { AssignmentView, TemplateDetail, TemplateSummary, TodayItem };

export function useTemplates(clinicId: string | null) {
  return useQuery({
    queryKey: ["templates", clinicId],
    queryFn: ({ signal }) => apiGet<{ templates: TemplateSummary[] }>(`/v1/templates${clinicId ? `?clinic=${clinicId}` : ""}`, { signal }).then((r) => r.templates),
    retry,
  });
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: ["template", id],
    queryFn: ({ signal }) => apiGet<{ template: TemplateDetail }>(`/v1/templates/${id}`, { signal }).then((r) => r.template),
    enabled: !!id,
    retry,
  });
}

export function useSaveTemplate(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TemplateInput) =>
      (id ? apiSend<{ template: TemplateDetail }>("PUT", `/v1/templates/${id}`, body) : apiSend<{ template: TemplateDetail }>("POST", "/v1/templates", body)).then((r) => r.template),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ["templates"] });
      qc.setQueryData(["template", t.id], t);
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ ok: true }>("DELETE", `/v1/templates/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export const assignmentKey = (patientId: string) => ["assignment", patientId] as const;

export function useAssignment(patientId: string) {
  return useQuery({
    queryKey: assignmentKey(patientId),
    queryFn: ({ signal }) => apiGet<{ assignment: AssignmentView | null }>(`/v1/patients/${patientId}/assignment`, { signal }).then((r) => r.assignment),
    retry,
  });
}

export function useAssign(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignInput) => apiSend<{ assignment: AssignmentView }>("POST", `/v1/patients/${patientId}/assignment`, body).then((r) => r.assignment),
    onSuccess: (a) => {
      qc.setQueryData(assignmentKey(patientId), a);
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useUpdateAssignment(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" | "cancelled" }) =>
      apiSend<{ assignment: AssignmentView | null }>("PATCH", `/v1/assignments/${id}`, { status }).then((r) => r.assignment),
    onSuccess: (a) => {
      qc.setQueryData(assignmentKey(patientId), a);
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useToday(clinicId: string | null) {
  return useQuery({
    queryKey: ["today", clinicId],
    queryFn: ({ signal }) => apiGet<{ items: TodayItem[] }>(`/v1/today${clinicId ? `?clinic=${clinicId}` : ""}`, { signal }).then((r) => r.items),
    retry,
  });
}

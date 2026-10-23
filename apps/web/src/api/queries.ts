import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "./http.ts";

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
export type PatientStatus = "pending_consent" | "consent_legacy" | "active" | "inactive" | "discharged";
export interface PatientRow {
  id: string;
  clinic_id: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
  status: PatientStatus;
}
export interface Patient extends PatientRow {
  preferred_locale: string | null;
}

/** Don't retry answers that won't change: signed out, MFA missing, not found. */
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: ({ signal }) => apiGet<Me>("/v1/me", { signal }), retry, staleTime: 60_000 });
}

export function usePatients(clinicId: string | null) {
  return useQuery({
    queryKey: ["patients", clinicId],
    queryFn: ({ signal }) =>
      apiGet<{ patients: PatientRow[] }>(clinicId ? `/v1/patients?clinic=${encodeURIComponent(clinicId)}` : "/v1/patients", { signal }).then((r) => r.patients),
    retry,
    enabled: clinicId !== undefined,
  });
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: ["patient", id],
    queryFn: ({ signal }) => apiGet<{ patient: Patient }>(`/v1/patients/${encodeURIComponent(id)}`, { signal }).then((r) => r.patient),
    retry,
  });
}

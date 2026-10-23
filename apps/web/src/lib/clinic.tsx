/**
 * The clinic the user is working in. A multi-clinic therapist works in one
 * clinic at a time (design doc §4.2). The choice only narrows what is shown;
 * the API still applies row-level security to every query.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Membership } from "../api/queries.ts";

interface ClinicCtx {
  clinics: Array<{ id: string; name: string; roles: Membership["role"][] }>;
  clinicId: string | null;
  setClinicId: (id: string) => void;
  /** The user manages the clinic they are working in (clinic manager or org admin). */
  isManager: boolean;
}

const Ctx = createContext<ClinicCtx | null>(null);

export function ClinicProvider({ memberships, children }: { memberships: Membership[]; children: ReactNode }) {
  const clinics = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; roles: Membership["role"][] }>();
    for (const m of memberships) {
      if (!m.clinic_id) continue;
      const c = byId.get(m.clinic_id) ?? { id: m.clinic_id, name: m.clinic_name ?? "", roles: [] };
      c.roles.push(m.role);
      byId.set(m.clinic_id, c);
    }
    return [...byId.values()];
  }, [memberships]);

  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return localStorage.getItem("emb.clinic");
    } catch {
      return null;
    }
  });
  const clinicId = clinics.find((c) => c.id === chosen)?.id ?? clinics[0]?.id ?? null;

  const roles = clinics.find((c) => c.id === clinicId)?.roles ?? [];
  const isManager = roles.includes("clinic_manager") || roles.includes("org_admin") || memberships.some((m) => m.clinic_id === null && m.role === "org_admin");
  const value = useMemo<ClinicCtx>(
    () => ({
      clinics,
      clinicId,
      isManager,
      setClinicId: (id) => {
        try {
          localStorage.setItem("emb.clinic", id);
        } catch {
          /* not remembered */
        }
        setChosen(id);
      },
    }),
    [clinics, clinicId, isManager],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClinic(): ClinicCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useClinic outside ClinicProvider");
  return c;
}

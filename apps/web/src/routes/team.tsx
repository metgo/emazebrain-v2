/** Team (design doc §5.2), for clinic managers: who works in this clinic. Invites come with email delivery. */
import { Avatar, Card, Chip, DataList, MazeLoader, PageHeader, type Column } from "@emb/ui";
import { useStaff, type StaffMember } from "../api/queries.ts";
import { useT } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { useTitle } from "../lib/title.ts";
import { LoadError } from "./shared.tsx";

export function TeamPage() {
  const t = useT();
  const { clinicId, clinics } = useClinic();
  const staff = useStaff(clinicId);
  useTitle(t("team.title"));
  const columns: Column<StaffMember>[] = [
    { id: "name", header: t("team.col.name"), primary: true, cell: (s) => s.full_name },
    {
      id: "role",
      header: t("team.col.role"),
      cell: (s) => (
        <span className="chips">
          {s.roles.map((r) => (
            <Chip key={r} tone={r === "clinic_manager" || r === "org_admin" ? "brand" : "neutral"}>
              {t("shell.role", { role: r })}
            </Chip>
          ))}
        </span>
      ),
    },
    { id: "email", header: t("team.col.email"), cell: (s) => <bdi dir="ltr">{s.email}</bdi> },
  ];
  return (
    <div className="app-page">
      <PageHeader title={t("team.title")} description={clinics.find((c) => c.id === clinicId)?.name} />
      {staff.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : staff.isError ? (
        <LoadError error={staff.error} retry={() => void staff.refetch()} />
      ) : (
        <Card padded={false}>
          <DataList rows={staff.data} columns={columns} getRowKey={(s) => s.id} caption={t("team.caption")} leading={(s) => <Avatar name={s.full_name} size={36} />} />
        </Card>
      )}
    </div>
  );
}

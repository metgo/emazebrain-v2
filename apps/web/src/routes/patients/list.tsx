/** Patients list (design doc §5.3): search, one clinic at a time, archived view for managers. */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import { Archive, Plus, Search, SearchX, TriangleAlert, Users, X } from "lucide-react";
import { Avatar, Button, Card, DataList, EmptyState, MazeLoader, PageHeader, Segmented, type Column } from "@emb/ui";
import { usePatients, type PatientListItem } from "../../api/queries.ts";
import { useT } from "../../i18n/index.tsx";
import { useClinic } from "../../lib/clinic.tsx";
import { calendarDate, matchesQuery } from "../../lib/format.ts";
import { useTitle } from "../../lib/title.ts";
import { fullName, LoadError, StatusChip, useAge } from "../shared.tsx";

export function PatientsPage() {
  const t = useT();
  const intl = useIntl();
  const { clinicId, isManager } = useClinic();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const archived = isManager && params.get("view") === "archived";
  const patients = usePatients(clinicId, archived);
  const age = useAge();
  useTitle(t("patients.title"));

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const rows = useMemo(() => (patients.data ?? []).filter((p) => matchesQuery([p.given_name, p.family_name, fullName(p)], query)), [patients.data, query]);

  const columns: Column<PatientListItem>[] = [
    {
      id: "name",
      header: t("patients.col.name"),
      primary: true,
      cell: (p) => (
        <span className="plist-name">
          <bdi>{fullName(p)}</bdi>
          {p.has_alert && (
            <span className="plist-alert" title={t("patients.hasAlert")}>
              <TriangleAlert size={16} aria-hidden="true" />
              <span className="emb-vh">{t("patients.hasAlert")}</span>
            </span>
          )}
        </span>
      ),
    },
    { id: "age", header: t("patients.col.age"), cell: (p) => age(p.date_of_birth) },
    {
      id: "dob",
      header: t("patients.col.dob"),
      hideOnCard: true,
      cell: (p) => <span className="emb-tnum">{intl.formatDate(calendarDate(p.date_of_birth), { day: "numeric", month: "short", year: "numeric" })}</span>,
    },
    { id: "status", header: t("patients.col.status"), cell: (p) => <StatusChip status={p.status} /> },
  ];

  const total = patients.data?.length ?? 0;
  const addButton = (
    <Link to="/patients/new" className="emb-btn emb-btn--primary">
      <Plus size={20} aria-hidden="true" />
      <span>{t("patients.add")}</span>
    </Link>
  );

  return (
    <div className="app-page">
      <PageHeader title={t("patients.title")} description={patients.data && !archived ? t("patients.count", { count: total }) : undefined} actions={archived ? undefined : addButton} />
      {isManager && (
        <div className="plist-view">
          <Segmented
            legend={<span className="emb-vh">{t("patients.view")}</span>}
            name="patients-view"
            value={archived ? "archived" : "current"}
            onChange={(v) => setParam("view", v === "archived" ? "archived" : "")}
            options={[
              { value: "current", label: t("patients.view.current") },
              { value: "archived", label: t("patients.view.archived") },
            ]}
          />
        </div>
      )}
      {patients.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : patients.isError ? (
        <LoadError error={patients.error} retry={() => void patients.refetch()} />
      ) : total === 0 ? (
        <Card>
          {archived ? (
            <EmptyState icon={<Archive size={28} aria-hidden="true" />} title={t("patients.archivedEmpty.title")}>
              {t("patients.archivedEmpty.body")}
            </EmptyState>
          ) : (
            <EmptyState icon={<Users size={28} aria-hidden="true" />} title={t("patients.empty.title")} action={addButton}>
              {t("patients.empty.body")}
            </EmptyState>
          )}
        </Card>
      ) : (
        <>
          <div className="app-toolbar" role="search">
            <label className="app-search">
              <Search size={20} aria-hidden="true" className="app-search__icon" />
              <span className="emb-vh">{t("patients.search")}</span>
              <input
                type="search"
                className="emb-input app-search__input"
                placeholder={t("patients.searchPlaceholder")}
                value={query}
                onChange={(e) => setParam("q", e.target.value)}
                enterKeyHint="search"
                autoComplete="off"
              />
            </label>
            <span className="app-muted" aria-live="polite">
              {query ? t("patients.results", { count: rows.length }) : ""}
            </span>
          </div>
          {rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchX size={28} aria-hidden="true" />}
                title={t("patients.noMatch.title", { query })}
                action={
                  <Button variant="secondary" icon={<X size={18} aria-hidden="true" />} onClick={() => setParam("q", "")}>
                    {t("patients.noMatch.clear")}
                  </Button>
                }
              >
                {t("patients.noMatch.body")}
              </EmptyState>
            </Card>
          ) : (
            <DataList
              rows={rows}
              columns={columns}
              getRowKey={(p) => p.id}
              caption={t("patients.caption")}
              getRowHref={(p) => `/patients/${p.id}`}
              renderLink={({ href, className, children }) => (
                <Link to={href} className={className}>
                  {children}
                </Link>
              )}
              leading={(p) => <Avatar name={fullName(p)} size={40} />}
            />
          )}
        </>
      )}
    </div>
  );
}

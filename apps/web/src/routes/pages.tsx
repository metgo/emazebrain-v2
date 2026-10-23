/**
 * Clinic pages for this slice: Today, Patients, one patient, Settings, More,
 * and honest "coming next" pages for destinations built in the MVP.
 */
import { useMemo, useState, type ComponentType } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarDays,
  CircleCheck,
  Compass,
  MessageSquare,
  Route as RouteIcon,
  Search,
  Settings as SettingsIcon,
  SearchX,
  Users,
  X,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { Alert, Avatar, Button, Card, Chip, DataList, EmptyState, MazeLoader, PageHeader, Segmented, type ChipTone, type Column } from "@emb/ui";
import { ApiError } from "../api/http.ts";
import { useMe, usePatient, usePatients, type PatientRow, type PatientStatus } from "../api/queries.ts";
import { useT, usePrefs, locales, type Locale, type MessageId, type Motion, type Theme } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { ageParts, calendarDate, dayPart, firstName, matchesQuery } from "../lib/format.ts";
import { useTitle } from "../lib/title.ts";
import { useSignOut } from "../shell/ClinicShell.tsx";

const statusTone: Record<PatientStatus, ChipTone> = {
  active: "success",
  pending_consent: "warning",
  consent_legacy: "warning",
  inactive: "neutral",
  discharged: "neutral",
};

const fullName = (p: { given_name: string; family_name: string }) => `${p.given_name} ${p.family_name}`;

function useAge() {
  const t = useT();
  return (dob: string) => {
    const { years, months } = ageParts(dob);
    return years >= 2 ? t("age.years", { years }) : t("age.months", { months });
  };
}

function StatusChip({ status }: { status: PatientStatus }) {
  const t = useT();
  return <Chip tone={statusTone[status] ?? "neutral"}>{t("patients.status", { status })}</Chip>;
}

export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  const network = error instanceof ApiError && error.status === 0;
  const ref = error instanceof ApiError ? error.requestId : undefined;
  return (
    <Alert
      tone="danger"
      title={t(network ? "errors.network" : "errors.generic")}
      action={
        <Button variant="secondary" onClick={retry}>
          {t("common.retry")}
        </Button>
      }
    >
      {ref && <span className="app-ref">{t("errors.reference", { id: ref })}</span>}
    </Alert>
  );
}

// ------------------------------------------------------------------ Today

export function TodayPage() {
  const t = useT();
  const intl = useIntl();
  const me = useMe();
  const { clinicId } = useClinic();
  const patients = usePatients(clinicId);
  const age = useAge();
  useTitle(t("nav.today"));
  const name = firstName(me.data?.user.name ?? "");
  const mine = (patients.data ?? []).filter((p) => p.status !== "discharged").slice(0, 6);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={intl.formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}
        title={t("today.greeting", { part: dayPart(), name })}
      />
      <div className="today-grid">
        <Card as="section" className="today-next" labelledBy="next-up">
          <h2 id="next-up" className="app-cardtitle">
            {t("today.nextUp.title")}
          </h2>
          <EmptyState icon={<CalendarDays size={28} aria-hidden="true" />} title={t("today.nextUp.empty")}>
            {t("today.nextUp.emptyBody")}
          </EmptyState>
        </Card>
        <Card as="section" className="today-attention" labelledBy="attention">
          <h2 id="attention" className="app-cardtitle">
            {t("today.attention.title")}
          </h2>
          <p className="today-clear">
            <CircleCheck size={20} aria-hidden="true" />
            {t("today.attention.empty")}
          </p>
        </Card>
        <Card as="section" className="today-patients" labelledBy="your-patients" padded={false}>
          <div className="app-cardhead">
            <h2 id="your-patients" className="app-cardtitle">
              {t("today.patients.title")}
            </h2>
            <Link to="/patients" className="app-textlink">
              {t("today.patients.all")}
              <ChevronRight size={18} aria-hidden="true" className="emb-flip-rtl" />
            </Link>
          </div>
          {patients.isPending ? (
            <MazeLoader label={t("common.loading")} />
          ) : patients.isError ? (
            <div className="app-cardpad">
              <LoadError error={patients.error} retry={() => void patients.refetch()} />
            </div>
          ) : mine.length === 0 ? (
            <p className="app-cardpad app-muted">{t("today.patients.empty")}</p>
          ) : (
            <ul className="today-plist">
              {mine.map((p) => (
                <li key={p.id} className="today-pitem">
                  <Avatar name={fullName(p)} size={40} />
                  <span className="today-pitem__text">
                    <Link to={`/patients/${p.id}`} className="emb-stretched">
                      <bdi>{fullName(p)}</bdi>
                    </Link>
                    <span className="app-muted">{age(p.date_of_birth)}</span>
                  </span>
                  <StatusChip status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Patients

export function PatientsPage() {
  const t = useT();
  const intl = useIntl();
  const { clinicId } = useClinic();
  const patients = usePatients(clinicId);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const age = useAge();
  useTitle(t("patients.title"));

  const setQuery = (q: string) => setParams(q ? { q } : {}, { replace: true });
  const rows = useMemo(() => (patients.data ?? []).filter((p) => matchesQuery([p.given_name, p.family_name, fullName(p)], query)), [patients.data, query]);

  const columns: Column<PatientRow>[] = [
    { id: "name", header: t("patients.col.name"), primary: true, cell: (p) => <bdi>{fullName(p)}</bdi> },
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

  return (
    <div className="app-page">
      <PageHeader title={t("patients.title")} description={patients.data ? t("patients.count", { count: total }) : undefined} />
      {patients.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : patients.isError ? (
        <LoadError error={patients.error} retry={() => void patients.refetch()} />
      ) : total === 0 ? (
        <Card>
          <EmptyState icon={<Users size={28} aria-hidden="true" />} title={t("patients.empty.title")}>
            {t("patients.empty.body")}
          </EmptyState>
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
                onChange={(e) => setQuery(e.target.value)}
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
                  <Button variant="secondary" icon={<X size={18} aria-hidden="true" />} onClick={() => setQuery("")}>
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

// ------------------------------------------------------------------ One patient

export function PatientPage() {
  const t = useT();
  const intl = useIntl();
  const { id = "" } = useParams();
  const patient = usePatient(id);
  const age = useAge();
  const p = patient.data;
  useTitle(p ? fullName(p) : t("patients.title"));

  const back = (
    <Link to="/patients" className="app-textlink app-back">
      <ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />
      {t("patient.back")}
    </Link>
  );

  if (patient.isPending) return <MazeLoader label={t("common.loading")} />;
  if (patient.isError) {
    const notFound = patient.error instanceof ApiError && patient.error.status === 404;
    return (
      <div className="app-page">
        {back}
        <h1 className="emb-vh">{t(notFound ? "patient.notFound.title" : "errors.generic")}</h1>
        {notFound ? (
          <Card>
            <EmptyState icon={<SearchX size={28} aria-hidden="true" />} title={t("patient.notFound.title")}>
              {t("patient.notFound.body")}
            </EmptyState>
          </Card>
        ) : (
          <LoadError error={patient.error} retry={() => void patient.refetch()} />
        )}
      </div>
    );
  }
  if (!p) return null;

  const lang = p.preferred_locale ?? "";
  return (
    <div className="app-page">
      {back}
      <header className="phead">
        <Avatar name={fullName(p)} size={64} />
        <div className="phead__text">
          <h1 className="phead__name">
            <bdi>{fullName(p)}</bdi>
          </h1>
          <p className="phead__meta">
            <span>{age(p.date_of_birth)}</span>
            <StatusChip status={p.status} />
          </p>
        </div>
      </header>
      <div className="pgrid">
        <Card as="section" labelledBy="p-details">
          <h2 id="p-details" className="app-cardtitle">
            {t("patient.details")}
          </h2>
          <dl className="app-dl">
            <div>
              <dt>{t("patient.dob")}</dt>
              <dd className="emb-tnum">{intl.formatDate(calendarDate(p.date_of_birth), { day: "numeric", month: "long", year: "numeric" })}</dd>
            </div>
            <div>
              <dt>{t("patient.age")}</dt>
              <dd>{age(p.date_of_birth)}</dd>
            </div>
            <div>
              <dt>{t("patient.status")}</dt>
              <dd>
                <StatusChip status={p.status} />
              </dd>
            </div>
            <div>
              <dt>{t("patient.language")}</dt>
              <dd>{t("patient.languageName", { lang: lang || "none" })}</dd>
            </div>
          </dl>
        </Card>
        <Card as="section">
          <EmptyState icon={<RouteIcon size={28} aria-hidden="true" />} title={t("patient.protocol.title")}>
            {t("patient.protocol.body")}
          </EmptyState>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Coming next

const soon: Record<string, { title: MessageId; body: MessageId; icon: ComponentType<{ size?: number; "aria-hidden"?: "true" }> }> = {
  calendar: { title: "nav.calendar", body: "soon.calendar", icon: CalendarDays },
  protocols: { title: "nav.protocols", body: "soon.protocols", icon: RouteIcon },
  library: { title: "nav.library", body: "soon.library", icon: BookOpen },
  messages: { title: "nav.messages", body: "soon.messages", icon: MessageSquare },
  reports: { title: "nav.reports", body: "soon.reports", icon: BarChart3 },
};

export function ComingSoonPage({ area }: { area: keyof typeof soon }) {
  const t = useT();
  const s = soon[area]!;
  useTitle(t(s.title));
  return (
    <div className="app-page">
      <PageHeader title={t(s.title)} />
      <Card>
        <EmptyState icon={<s.icon size={28} aria-hidden="true" />} title={t("soon.title")}>
          {t(s.body)}
        </EmptyState>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ More (phones)

export function MorePage() {
  const t = useT();
  const signOut = useSignOut();
  useTitle(t("nav.more"));
  const links: Array<{ to: string; label: MessageId; icon: ComponentType<{ size?: number; "aria-hidden"?: "true" }> }> = [
    { to: "/protocols", label: "nav.protocols", icon: RouteIcon },
    { to: "/library", label: "nav.library", icon: BookOpen },
    { to: "/reports", label: "nav.reports", icon: BarChart3 },
    { to: "/settings", label: "nav.settings", icon: SettingsIcon },
  ];
  return (
    <div className="app-page">
      <PageHeader title={t("nav.more")} />
      <Card padded={false}>
        <ul className="more-list">
          {links.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="more-item">
                <l.icon size={22} aria-hidden="true" />
                <span>{t(l.label)}</span>
                <ChevronRight size={20} aria-hidden="true" className="emb-flip-rtl more-item__chev" />
              </Link>
            </li>
          ))}
          <li>
            <button type="button" className="more-item" onClick={() => void signOut("signed_out")}>
              <LogOut size={22} aria-hidden="true" className="emb-flip-rtl" />
              <span>{t("common.signOut")}</span>
            </button>
          </li>
        </ul>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Settings

export function SettingsPage() {
  const t = useT();
  const me = useMe();
  const { locale, setLocale, theme, setTheme, motion, setMotion } = usePrefs();
  const signOut = useSignOut();
  useTitle(t("settings.title"));
  return (
    <div className="app-page app-page--narrow">
      <PageHeader title={t("settings.title")} />
      <div className="settings">
        <Card as="section" labelledBy="prefs">
          <h2 id="prefs" className="app-cardtitle">
            {t("settings.preferences")}
          </h2>
          <div className="settings__group">
            <Segmented<Locale>
              legend={t("language.label")}
              name="language"
              value={locale}
              onChange={setLocale}
              options={locales.map((l) => ({ value: l, label: <span lang={l}>{t(`language.${l}`)}</span> }))}
            />
            <Segmented<Theme>
              legend={t("settings.theme")}
              name="theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: t("settings.theme.light") },
                { value: "dark", label: t("settings.theme.dark") },
                { value: "system", label: t("settings.theme.system") },
              ]}
            />
            <Segmented<Motion>
              legend={t("settings.motion")}
              name="motion"
              value={motion}
              onChange={setMotion}
              options={[
                { value: "system", label: t("settings.motion.system") },
                { value: "reduce", label: t("settings.motion.reduce") },
              ]}
            />
          </div>
        </Card>
        <Card as="section" labelledBy="account">
          <h2 id="account" className="app-cardtitle">
            {t("settings.account")}
          </h2>
          <dl className="app-dl">
            <div>
              <dt>{t("settings.email")}</dt>
              <dd>
                <bdi dir="ltr">{me.data?.user.email}</bdi>
              </dd>
            </div>
            <div>
              <dt>{t("settings.twoFactor")}</dt>
              <dd>
                <Chip tone="success" icon={<CircleCheck size={14} aria-hidden="true" />}>
                  {t("settings.twoFactor.on")}
                </Chip>
              </dd>
            </div>
          </dl>
          <div className="settings__actions">
            <Button variant="secondary" icon={<LogOut size={18} aria-hidden="true" className="emb-flip-rtl" />} onClick={() => void signOut("signed_out")}>
              {t("common.signOut")}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 404

export function NotFoundPage() {
  const t = useT();
  useTitle(t("notFound.title"));
  return (
    <div className="app-page">
      <h1 className="emb-vh">{t("notFound.title")}</h1>
      <Card>
        <EmptyState
          icon={<Compass size={28} aria-hidden="true" />}
          title={t("notFound.title")}
          action={
            <Link to="/today" className="emb-btn emb-btn--primary">
              {t("notFound.action")}
            </Link>
          }
        >
          {t("notFound.body")}
        </EmptyState>
      </Card>
    </div>
  );
}

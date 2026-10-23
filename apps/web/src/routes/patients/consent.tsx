/**
 * In-clinic consent (design doc §5.10, §11.3): the therapist picks the legal
 * guardian, hands over the tablet, and the guardian reads and signs in their
 * own language. The screen has no app navigation while the guardian holds it.
 * Each choice becomes an append-only consent row.
 */
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { IntlProvider } from "react-intl";
import { CircleCheck, HandHeart } from "lucide-react";
import { CONSENT_PURPOSES, type ConsentPurpose, type RecordConsent } from "@emb/contracts";
import { Alert, Button, Card, CheckboxField, Logo, MazeLoader, Segmented, TextField } from "@emb/ui";
import { usePatient, useRecordConsent, type PatientDetail } from "../../api/queries.ts";
import { catalogs, isRtl, locales, useT, usePrefs, type Locale, type MessageId } from "../../i18n/index.tsx";
import { useClinic } from "../../lib/clinic.tsx";
import { useTitle } from "../../lib/title.ts";
import { fullName, LoadError } from "../shared.tsx";

type Step = { name: "choose" } | { name: "sign"; guardianId: string } | { name: "done"; guardianName: string; locale: Locale };

export function ConsentPage() {
  const t = useT();
  const { id = "" } = useParams();
  const patient = usePatient(id);
  const [step, setStep] = useState<Step>({ name: "choose" });
  useTitle(t("consentFlow.title"));

  if (patient.isPending) return <MazeLoader label={t("common.loading")} />;
  if (patient.isError) {
    return (
      <div className="handoff">
        <LoadError error={patient.error} retry={() => void patient.refetch()} />
      </div>
    );
  }
  const p = patient.data;
  const back = (
    <Link to={`/patients/${p.id}/family`} className="emb-btn emb-btn--secondary">
      {t("consentFlow.back", { child: p.given_name })}
    </Link>
  );

  return (
    <div className="handoff">
      <div className="handoff__top">
        <Logo />
      </div>
      <main id="main" className="handoff__main">
        {step.name === "choose" && <ChooseGuardian patient={p} back={back} onChoose={(guardianId) => setStep({ name: "sign", guardianId })} />}
        {step.name === "sign" && (
          <SignConsent
            patient={p}
            guardianId={step.guardianId}
            onSigned={(guardianName, locale) => setStep({ name: "done", guardianName, locale })}
            onBack={() => setStep({ name: "choose" })}
          />
        )}
        {step.name === "done" && (
          <Card>
            <ConsentText locale={step.locale}>
              {(ct) => (
                <div className="handoff__done">
                  <CircleCheck size={56} aria-hidden="true" className="handoff__doneicon" />
                  <h1 className="auth__title">{ct("consentDoc.thanks", { name: step.guardianName })}</h1>
                  <p className="auth__subtitle">{ct("consentDoc.thanksBody")}</p>
                </div>
              )}
            </ConsentText>
            <div className="handoff__doneaction">{back}</div>
          </Card>
        )}
      </main>
    </div>
  );
}

function ChooseGuardian({ patient: p, back, onChoose }: { patient: PatientDetail; back: React.ReactNode; onChoose: (id: string) => void }) {
  const t = useT();
  const legal = p.guardians.filter((g) => g.is_legal_guardian);
  const [chosen, setChosen] = useState(legal[0]?.id ?? "");
  const name = legal.find((g) => g.id === chosen)?.full_name ?? "";
  return (
    <Card>
      <form
        className="handoff__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen) onChoose(chosen);
        }}
      >
        <h1 className="auth__title">{t("consentFlow.title")}</h1>
        <p className="auth__subtitle">
          <bdi>{fullName(p)}</bdi>
        </p>
        {legal.length === 0 ? (
          <Alert tone="info">{t("consentFlow.noLegal")}</Alert>
        ) : (
          <fieldset className="choice">
            <legend className="emb-field__label">{t("consentFlow.choose")}</legend>
            <p className="emb-field__hint">{t("consentFlow.chooseHint")}</p>
            {legal.map((g) => (
              <label key={g.id} className={g.id === chosen ? "choice__option is-selected" : "choice__option"}>
                <input type="radio" name="guardian" value={g.id} checked={g.id === chosen} onChange={() => setChosen(g.id)} />
                <span>
                  <bdi>{g.full_name}</bdi>
                  <span className="app-muted"> · {t("guardian.relValue", { rel: g.relationship })}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="pform__actions">
          {back}
          {legal.length > 0 && (
            <Button type="submit" icon={<HandHeart size={20} aria-hidden="true" />}>
              {t("consentFlow.handOver", { name })}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/** Renders children in the guardian's language and direction, independent of the app's. */
function ConsentText({ locale, children }: { locale: Locale; children: (t: (id: MessageId, values?: Record<string, string>) => string) => React.ReactNode }) {
  return (
    <IntlProvider locale={locale} messages={catalogs[locale]} defaultLocale="en">
      <div lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} className="consenttext">
        <Translated>{children}</Translated>
      </div>
    </IntlProvider>
  );
}
function Translated({ children }: { children: (t: (id: MessageId, values?: Record<string, string>) => string) => React.ReactNode }) {
  const t = useT();
  return <>{children(t)}</>;
}

function SignConsent({ patient: p, guardianId, onSigned, onBack }: { patient: PatientDetail; guardianId: string; onSigned: (name: string, locale: Locale) => void; onBack: () => void }) {
  const t = useT();
  const { locale: appLocale } = usePrefs();
  const { clinics, clinicId } = useClinic();
  const guardian = p.guardians.find((g) => g.id === guardianId)!;
  const record = useRecordConsent(p.id);
  const [locale, setLocale] = useState<Locale>(() => ((locales as readonly string[]).includes(guardian.preferred_locale) ? (guardian.preferred_locale as Locale) : appLocale));
  const current = new Map(p.consents.map((c) => [c.purpose, c.decision]));
  const [choices, setChoices] = useState<Record<ConsentPurpose, boolean>>(
    () => Object.fromEntries(CONSENT_PURPOSES.map((pp) => [pp, current.get(pp) === "granted"])) as Record<ConsentPurpose, boolean>,
  );
  const [signer, setSigner] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  const clinicName = clinics.find((c) => c.id === (p.clinic_id ?? clinicId))?.name ?? "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const decisions: RecordConsent["decisions"] = {};
    for (const purpose of CONSENT_PURPOSES) {
      const was = current.get(purpose) === "granted";
      if (choices[purpose] && !was) decisions[purpose] = "granted";
      if (!choices[purpose] && was) decisions[purpose] = "withdrawn";
    }
    if (Object.keys(decisions).length === 0) return setError("consentDoc.noChange");
    if (!signer.trim()) return setError("errors.required");
    if (!confirmed) return setError("consentDoc.needConfirm");
    setError(null);
    try {
      await record.mutateAsync({ guardian_id: guardianId, signer_name: signer.trim(), locale, decisions });
      onSigned(guardian.full_name, locale);
    } catch {
      setError("errors.generic");
    }
  };

  return (
    <Card>
      <div className="consent__lang">
        <Segmented<Locale>
          legend={<span className="emb-vh">{t("language.label")}</span>}
          name="consent-language"
          value={locale}
          onChange={(l) => {
            setLocale(l);
            setError(null);
          }}
          options={locales.map((l) => ({ value: l, label: <span lang={l}>{t(`language.${l}`)}</span> }))}
        />
      </div>
      <ConsentText locale={locale}>
        {(ct) => (
          <form className="handoff__form" onSubmit={(e) => void submit(e)} noValidate>
            <h1 className="auth__title">{ct("consentDoc.title", { child: p.given_name })}</h1>
            <p className="consent__intro">{ct("consentDoc.intro", { clinic: clinicName, child: p.given_name })}</p>
            <p className="app-muted consent__draft">{ct("consentDoc.draft")}</p>
            {error && <Alert tone="danger">{ct(error)}</Alert>}
            <div className="consent__items">
              {CONSENT_PURPOSES.map((purpose) => (
                <CheckboxField
                  key={purpose}
                  className="consent__item"
                  label={ct("consent.purpose", { purpose })}
                  hint={ct(`consentDoc.${purpose}` as MessageId)}
                  {...(purpose === "treatment" ? { tag: ct("consentDoc.required") } : {})}
                  checked={choices[purpose]}
                  onChange={(e) => {
                    setChoices((c) => ({ ...c, [purpose]: e.target.checked }));
                    setError(null);
                  }}
                />
              ))}
            </div>
            <TextField
              label={ct("consentDoc.signature")}
              hint={ct("consentDoc.signatureHint")}
              name="signer_name"
              autoComplete="off"
              value={signer}
              onChange={(e) => {
                setSigner(e.target.value);
                setError(null);
              }}
            />
            <CheckboxField
              label={ct("consentDoc.confirm", { child: p.given_name })}
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setError(null);
              }}
            />
            <div className="pform__actions">
              <Button variant="secondary" onClick={onBack}>
                {ct("common.back")}
              </Button>
              <Button type="submit" size="lg" loading={record.isPending}>
                {ct("consentDoc.sign")}
              </Button>
            </div>
          </form>
        )}
      </ConsentText>
    </Card>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { buildFormPreview, DEFAULT_FORM_CONFIG, type PreviewField } from "@/lib/operations/website-requests-core";
import { useEmbedParent } from "./useEmbedParent";
import {
  EMPTY_PUBLIC_FORM_VALUES,
  PUBLIC_FORM_COPY,
  PUBLIC_FORM_INPUT_LIMITS,
  WEEKDAYS,
  acquisitionFromLocation,
  acquisitionStorageKey,
  buildSubmissionBody,
  firstInvalidField,
  mergeFirstTouch,
  publicFormVersionLabel,
  sanitizeAcquisitionContext,
  validatePublicFormValues,
  type PublicFormConfig,
  type PublicFormFieldErrors,
  type PublicFormValues,
} from "@/lib/public-forms/public-form-core";

/**
 * The passenger-facing Nemryn request form (P1-COMM-D2), used by the hosted page (/request/[key]) and the embed iframe
 * (/embed/request/[key]). It renders from the SAME model the operator previews in Settings (`buildFormPreview`), so the preview
 * and the live form can not drift, and every field is a field of the canonical intake contract.
 *
 * Privacy: passenger input lives only in component state -- never localStorage / sessionStorage / IndexedDB / a cookie / a service
 * worker cache. The ONLY thing persisted in the browser is the acquisition-only first-touch context (S4C values, no passenger data).
 * Idempotency: one client submission reference per form instance, reused for every retry; the button is disabled while a
 * submission is pending; the server-side unique constraint is authoritative.
 */

type Mode = "hosted" | "embed";
type Status = "editing" | "sending" | "sent" | "unavailable";

const FIELD_BASE = "w-full rounded-sm border bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-400";

function autoComplete(key: string): string | undefined {
  return key === "requesterName" ? "name" : key === "requesterPhone" ? "tel" : key === "requesterEmail" ? "email" : "off";
}
function maxLengthOf(key: string): number | undefined {
  switch (key) {
    case "requesterName": case "passengerName": return PUBLIC_FORM_INPUT_LIMITS.name;
    case "requesterPhone": return PUBLIC_FORM_INPUT_LIMITS.phone;
    case "requesterEmail": return PUBLIC_FORM_INPUT_LIMITS.email;
    case "pickupDescription": case "destinationDescription": return PUBLIC_FORM_INPUT_LIMITS.address;
    case "assistanceNotes": case "additionalNotes": return PUBLIC_FORM_INPUT_LIMITS.notes;
    default: return undefined;
  }
}

export function PublicRequestForm({ publicKey, config, mode }: { publicKey: string; config: PublicFormConfig; mode: Mode }) {
  const formConfig = useMemo(
    () => ({
      ...DEFAULT_FORM_CONFIG,
      status: "ready" as const,
      title: config.title,
      introText: config.introText,
      submitLabel: config.submitLabel,
      confirmationMessage: config.confirmationMessage,
      offeredServiceTypes: config.services,
      allowRecurring: config.allowRecurring,
      requireServiceChoice: config.requireServiceChoice,
    }),
    [config],
  );
  const model = useMemo(
    () => buildFormPreview({ organizationName: config.organizationName, config: formConfig, services: config.services, version: config.formVersion }),
    [config, formConfig],
  );

  const [values, setValues] = useState<PublicFormValues>(EMPTY_PUBLIC_FORM_VALUES);
  const [errors, setErrors] = useState<PublicFormFieldErrors>({});
  const [status, setStatus] = useState<Status>("editing");
  const [banner, setBanner] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const submissionRef = useRef<string | null>(null); // the client submission reference (idempotency key)
  const sendingRef = useRef(false); // synchronous double-submit guard (state updates are async)
  const acquisitionRef = useRef<Record<string, string> | null>(null);

  const setValue = useCallback(<K extends keyof PublicFormValues>(key: K, value: PublicFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] === undefined ? current : { ...current, [key]: undefined }));
  }, []);

  // ---- acquisition context: hosted = this top-level page; embed = the tenant page, delivered by the loader ---------------
  useEffect(() => {
    if (mode !== "hosted") return;
    const current = acquisitionFromLocation({ search: window.location.search, pathname: window.location.pathname, referrer: document.referrer, ownHost: window.location.hostname });
    let stored: Record<string, string> | null = null;
    try {
      const raw = window.sessionStorage.getItem(acquisitionStorageKey(publicKey));
      stored = raw ? sanitizeAcquisitionContext(JSON.parse(raw)) : null;
    } catch {
      stored = null;
    }
    const merged = mergeFirstTouch(stored, current);
    acquisitionRef.current = merged;
    try {
      window.sessionStorage.setItem(acquisitionStorageKey(publicKey), JSON.stringify(merged)); // S4C values only, never passenger data
    } catch {
      /* storage unavailable: attribution simply stays in memory */
    }
  }, [mode, publicKey]);

  // ---- embed: talk to the trusted loader in the parent window (validated postMessage protocol, see useEmbedParent) ------------
  const postToParent = useEmbedParent({
    enabled: mode === "embed",
    publicKey,
    rootRef,
    onContext: (context) => {
      acquisitionRef.current = context;
    },
  });

  // ---- focus management ----------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (status === "sent") confirmationRef.current?.focus();
  }, [status]);
  useEffect(() => {
    if (tick > 0 && Object.values(errors).some(Boolean)) summaryRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current) return; // double click / double Enter: exactly one in flight
    const found = validatePublicFormValues(values, config);
    if (firstInvalidField(found)) {
      setErrors(found);
      setBanner(PUBLIC_FORM_COPY.checkInfo);
      setTick((n) => n + 1);
      return;
    }
    setErrors({});
    setBanner(null);
    sendingRef.current = true;
    setStatus("sending");
    // ONE submission reference per form instance; a retry after a network failure re-sends the SAME reference.
    submissionRef.current ??= crypto.randomUUID();
    const acquisition: Record<string, string> = { ...(acquisitionRef.current ?? {}), formVersion: publicFormVersionLabel(config.formVersion) };
    if (mode === "hosted") acquisition.submissionPath = window.location.pathname.startsWith("/") ? window.location.pathname : "/";
    try {
      const response = await fetch(`/api/public-forms/${publicKey}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSubmissionBody(values, config, { idempotencyKey: submissionRef.current, acquisition })),
        cache: "no-store",
        credentials: "omit",
      });
      if (response.ok) {
        setValues(EMPTY_PUBLIC_FORM_VALUES); // passenger data leaves memory as soon as it was accepted
        setStatus("sent");
        postToParent("submitted");
      } else if (response.status === 404) {
        setStatus("unavailable");
      } else if (response.status === 400) {
        setStatus("editing");
        setBanner(PUBLIC_FORM_COPY.checkInfo);
        setTick((n) => n + 1);
      } else {
        setStatus("editing");
        setBanner(PUBLIC_FORM_COPY.couldNotSend);
        setTick((n) => n + 1);
      }
    } catch {
      setStatus("editing");
      setBanner(PUBLIC_FORM_COPY.couldNotSend);
      setTick((n) => n + 1);
    } finally {
      sendingRef.current = false;
    }
  }

  function startAnother() {
    submissionRef.current = null; // a genuinely new request gets a new submission reference
    setErrors({});
    setBanner(null);
    setStatus("editing");
  }

  const errorEntries = (Object.entries(errors) as [keyof PublicFormValues, string | undefined][]).filter(([, message]) => message);

  function renderField(field: PreviewField) {
    const key = field.key as keyof PublicFormValues;
    const id = `pf-${field.key}`;
    const error = errors[key];
    const describedBy = [field.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
    const label = (
      <span id={`${id}-label`} className="text-sm font-medium text-neutral-900">
        {field.label}
        {field.required ? <span aria-hidden className="text-red-700"> *</span> : <span className="font-normal text-neutral-600"> (optional)</span>}
      </span>
    );
    const help = field.help ? <span id={`${id}-help`} className="text-xs text-neutral-600">{field.help}</span> : null;
    const err = error ? <span id={`${id}-error`} className="text-xs font-medium text-red-700">{error}</span> : null;
    const border = error ? "border-red-700" : "border-neutral-500";

    if (field.kind === "checkbox") {
      return (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="flex items-start gap-2 text-sm text-neutral-900">
            <input id={id} type="checkbox" className="mt-1 size-4" checked={values.recurring} onChange={(e) => setValue("recurring", e.target.checked)} aria-describedby={describedBy} />
            <span>{field.label}</span>
          </label>
          {help}
        </div>
      );
    }
    if (field.kind === "radio" || field.kind === "weekdays") {
      const options = field.kind === "weekdays" ? WEEKDAYS.map((d) => ({ value: d.value as string, label: d.label as string })) : field.options ?? [];
      return (
        <fieldset key={field.key} className="flex flex-col gap-1.5" aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
          <legend className="mb-1.5">{label}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {options.map((option, index) => {
              const checked = field.kind === "radio" ? values.returnTripNeeded === option.value : values.recurringDays.includes(option.value);
              return (
                <label key={option.value} className="flex items-center gap-2 text-sm text-neutral-900">
                  <input
                    id={index === 0 ? id : undefined}
                    type={field.kind === "radio" ? "radio" : "checkbox"}
                    name={field.key}
                    value={option.value}
                    className="size-4"
                    checked={checked}
                    onChange={() =>
                      field.kind === "radio"
                        ? setValue("returnTripNeeded", option.value as PublicFormValues["returnTripNeeded"])
                        : setValue("recurringDays", checked ? values.recurringDays.filter((d) => d !== option.value) : [...values.recurringDays, option.value])
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          {help}
          {err}
        </fieldset>
      );
    }

    const common = {
      id,
      "aria-describedby": describedBy,
      "aria-invalid": error ? true : undefined,
      "aria-required": field.required || undefined,
      className: `${FIELD_BASE} ${border}`,
      autoComplete: autoComplete(field.key),
      maxLength: maxLengthOf(field.key),
    };
    const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValue(key, e.target.value as never);
    let control;
    if (field.kind === "textarea") control = <textarea {...common} rows={field.key === "pickupDescription" || field.key === "destinationDescription" ? 2 : 3} value={values[key] as string} onChange={onChange} />;
    else if (field.kind === "select")
      control = (
        <select {...common} value={values[key] as string} onChange={onChange}>
          <option value="">Choose…</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    else control = <input {...common} type={field.kind} inputMode={field.kind === "tel" ? "tel" : undefined} value={values[key] as string} onChange={onChange} />;
    return (
      <div key={field.key} className="flex flex-col gap-1.5">
        <label htmlFor={id} id={`${id}-label`} className="flex flex-col">{label}</label>
        {control}
        {help}
        {err}
      </div>
    );
  }

  const shell = (children: React.ReactNode) => (
    <div ref={rootRef} className={mode === "embed" ? "bg-white p-4 text-neutral-900" : "mx-auto w-full max-w-2xl bg-white p-4 text-neutral-900 sm:my-8 sm:rounded-lg sm:border sm:border-neutral-300 sm:p-8"}>
      {children}
      {mode === "hosted" && <p className="mt-8 text-center text-xs text-neutral-600">{PUBLIC_FORM_COPY.poweredBy}</p>}
    </div>
  );

  if (status === "unavailable") {
    return shell(
      <div role="alert" className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{PUBLIC_FORM_COPY.unavailableTitle}</h1>
        <p className="text-base text-neutral-700">{PUBLIC_FORM_COPY.unavailableBody}</p>
      </div>,
    );
  }

  if (status === "sent") {
    return shell(
      <div ref={confirmationRef} tabIndex={-1} role="status" data-testid="public-form-confirmation" className="flex flex-col gap-3 outline-none">
        <h1 className="text-xl font-semibold">{PUBLIC_FORM_COPY.received}</h1>
        <p className="whitespace-pre-line text-base text-neutral-800">{config.confirmationMessage}</p>
        <button type="button" onClick={startAnother} className="self-start rounded-sm border border-neutral-500 px-4 py-2 text-sm font-medium text-neutral-900">
          {PUBLIC_FORM_COPY.submitAnother}
        </button>
      </div>,
    );
  }

  const sending = status === "sending";
  return shell(
    <>
      <header className="mb-4 flex flex-col gap-1">
        <p className="text-sm text-neutral-600">{config.organizationName}</p>
        {mode === "hosted" ? <h1 className="text-2xl font-semibold">{model.title}</h1> : <h1 className="text-xl font-semibold">{model.title}</h1>}
        {model.intro && <p className="whitespace-pre-line text-base text-neutral-700">{model.intro}</p>}
      </header>
      <p className="mb-4 rounded-sm bg-neutral-100 p-3 text-sm text-neutral-900">{model.safetyNote}</p>
      <form onSubmit={onSubmit} noValidate aria-busy={sending || undefined} data-testid="public-request-form" className="flex flex-col gap-5">
        <div ref={summaryRef} tabIndex={-1} role="alert" className={banner ? "rounded-sm border border-red-700 bg-red-50 p-3 text-sm text-red-900 outline-none" : "sr-only"}>
          {banner && (
            <>
              <p className="font-medium">{banner}</p>
              {errorEntries.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {errorEntries.map(([key, message]) => (
                    <li key={key}><a href={`#pf-${key}`} className="underline" onClick={(e) => { e.preventDefault(); document.getElementById(`pf-${key}`)?.focus(); }}>{message}</a></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        {model.sections.map((section, s) => (
          <section key={section.heading} aria-labelledby={`pf-section-${s}`} className="flex flex-col gap-4">
            <h2 id={`pf-section-${s}`} className="text-base font-semibold">{section.heading}</h2>
            {section.fields.filter((f) => f.showWhen !== "recurring" || (config.allowRecurring && values.recurring)).map((f) => renderField(f))}
          </section>
        ))}
        <p className="text-xs text-neutral-600">{model.privacyNote}</p>
        <button
          type="submit"
          disabled={sending}
          aria-disabled={sending}
          className="self-start rounded-sm bg-neutral-900 px-5 py-3 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? "Sending…" : model.submitLabel}
        </button>
      </form>
    </>,
  );
}

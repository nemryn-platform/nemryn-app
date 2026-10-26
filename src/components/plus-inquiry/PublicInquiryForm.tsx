"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  EMPTY_INQUIRY_VALUES,
  INQUIRY_COPY,
  INQUIRY_LIMITS,
  INQUIRY_TYPE_OPTIONS,
  PREFERRED_REPLY_OPTIONS,
  RELATIONSHIP_OPTIONS,
  TIMEFRAME_OPTIONS,
  buildInquiryBody,
  firstInvalidInquiryField,
  inquiryAcquisitionStorageKey,
  validateInquiryValues,
  type InquiryFieldErrors,
  type InquiryValues,
} from "@/lib/plus-inquiry/inquiry-core";
import { acquisitionFromLocation, mergeFirstTouch, sanitizeAcquisitionContext } from "@/lib/public-forms/public-form-core";
import { useInquiryEmbedParent } from "./useInquiryEmbedParent";

/**
 * The public Nemryn Plus inquiry form (NP-P2-S7-B): the hosted page (/inquiry/[key]) and the embed iframe (/embed/inquiry/[key]).
 * A QUESTION form, not a booking form: it creates one inquiry for the organization's staff to review (ZD-243).
 *
 * Fields are the approved minimum (ZD-246): name; phone and/or email; preferred reply; optional relationship, service and
 * timeframe; the question type and the question. Both consent boxes are optional and unticked (ZD-252).
 * Privacy: input lives only in component state; the ONLY browser storage is the acquisition-only first-touch context (no content).
 * Idempotency: one submission reference per form instance, reused for every retry; one request in flight at a time.
 */

type Mode = "hosted" | "embed";
type Status = "editing" | "sending" | "sent" | "unavailable";
export interface InquiryFormProps {
  publicKey: string;
  mode: Mode;
  form: { organizationName: string; headline: string; introText: string | null; services: { value: string; label: string }[]; configVersion: number };
}

const FIELD = "w-full rounded-md border bg-white px-3 py-2.5 text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-action-primary-background/40";
const err = (e?: string) => (e ? "border-red-700" : "border-neutral-400");

export function PublicInquiryForm({ publicKey, mode, form }: InquiryFormProps) {
  const [values, setValues] = useState<InquiryValues>(EMPTY_INQUIRY_VALUES);
  const [errors, setErrors] = useState<InquiryFieldErrors>({});
  const [status, setStatus] = useState<Status>("editing");
  const [banner, setBanner] = useState<{ text: string; reload?: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const submissionRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const acquisitionRef = useRef<Record<string, string> | null>(null);
  const services = form.services.map((s) => s.value);
  const org = form.organizationName;

  const set = useCallback(<K extends keyof InquiryValues>(key: K, value: InquiryValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] === undefined ? e : { ...e, [key]: undefined }));
  }, []);

  useEffect(() => {
    if (mode !== "hosted") return;
    const current = acquisitionFromLocation({ search: window.location.search, pathname: window.location.pathname, referrer: document.referrer, ownHost: window.location.hostname });
    let stored: Record<string, string> | null = null;
    try {
      const raw = window.sessionStorage.getItem(inquiryAcquisitionStorageKey(publicKey));
      stored = raw ? sanitizeAcquisitionContext(JSON.parse(raw)) : null;
    } catch {
      stored = null;
    }
    const merged = mergeFirstTouch(stored, current);
    acquisitionRef.current = merged;
    try {
      window.sessionStorage.setItem(inquiryAcquisitionStorageKey(publicKey), JSON.stringify(merged)); // acquisition values only
    } catch {
      /* storage unavailable: attribution stays in memory */
    }
  }, [mode, publicKey]);

  const postToParent = useInquiryEmbedParent({ enabled: mode === "embed", publicKey, rootRef, onContext: (c) => { acquisitionRef.current = c; } });

  useEffect(() => {
    if (status === "sent") doneRef.current?.focus();
  }, [status]);
  useEffect(() => {
    if (tick > 0) summaryRef.current?.focus();
  }, [tick]);

  function fail(text: string, reload = false) {
    setStatus("editing");
    setBanner({ text, reload });
    setTick((n) => n + 1);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current) return;
    const found = validateInquiryValues(values, services);
    if (firstInvalidInquiryField(found)) {
      setErrors(found);
      fail(INQUIRY_COPY.checkInfo);
      return;
    }
    setErrors({});
    setBanner(null);
    sendingRef.current = true;
    setStatus("sending");
    submissionRef.current ??= crypto.randomUUID();
    const acquisition = { ...(acquisitionRef.current ?? {}) };
    if (mode === "hosted") acquisition.submissionPath = window.location.pathname;
    try {
      const response = await fetch(`/api/plus-inquiries/${publicKey}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildInquiryBody(values, { idempotencyKey: submissionRef.current, configVersion: form.configVersion, acquisition })),
        cache: "no-store",
        credentials: "omit",
      });
      if (response.ok) {
        setValues(EMPTY_INQUIRY_VALUES); // content leaves memory once accepted
        setStatus("sent");
        postToParent("submitted");
      } else if (response.status === 404) setStatus("unavailable");
      else if (response.status === 409) fail(INQUIRY_COPY.formChanged, true);
      else if (response.status === 400) fail(INQUIRY_COPY.checkInfo);
      else if (response.status === 429) fail(INQUIRY_COPY.rateLimited);
      else fail(INQUIRY_COPY.couldNotSend);
    } catch {
      fail(INQUIRY_COPY.couldNotSend);
    } finally {
      sendingRef.current = false;
    }
  }

  function another() {
    submissionRef.current = null;
    setErrors({});
    setBanner(null);
    setStatus("editing");
  }

  const shell = (children: ReactNode) => (
    <div
      ref={rootRef}
      data-testid="public-inquiry-root"
      className={mode === "embed" ? "bg-white p-4 text-neutral-900 sm:p-6" : "mx-auto w-full max-w-2xl bg-white p-5 text-neutral-900 sm:my-10 sm:rounded-xl sm:border sm:border-neutral-200 sm:p-10 sm:shadow-sm"}
    >
      {children}
      {mode === "hosted" && <p className="mt-10 text-center text-xs text-neutral-500">{INQUIRY_COPY.poweredBy}</p>}
    </div>
  );

  if (status === "unavailable") {
    return shell(
      <div role="alert" data-testid="public-inquiry-unavailable" className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{INQUIRY_COPY.unavailableTitle}</h1>
        <p className="text-base text-neutral-700">{INQUIRY_COPY.unavailableBody}</p>
      </div>,
    );
  }
  if (status === "sent") {
    return shell(
      <div ref={doneRef} tabIndex={-1} role="status" data-testid="public-inquiry-confirmation" className="flex flex-col gap-3 outline-none">
        <h1 className="text-2xl font-semibold">{INQUIRY_COPY.received}</h1>
        <p className="text-base text-neutral-700">{INQUIRY_COPY.receivedBody(org)}</p>
        <button type="button" onClick={another} className="self-start rounded-md border border-neutral-400 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50">
          {INQUIRY_COPY.submitAnother}
        </button>
      </div>,
    );
  }

  const sending = status === "sending";
  const errorList = (Object.entries(errors) as [keyof InquiryValues, string | undefined][]).filter(([, m]) => m);
  const labelFor = (id: string, text: string, required: boolean) => (
    <label htmlFor={id} className="text-sm font-medium text-neutral-900">
      {text}
      {required ? <span aria-hidden className="text-red-700"> *</span> : <span className="font-normal text-neutral-500"> (optional)</span>}
    </label>
  );
  const fieldError = (key: keyof InquiryValues) =>
    errors[key] ? <span id={`iq-${key}-error`} className="text-xs font-medium text-red-700">{errors[key]}</span> : null;
  const aria = (key: keyof InquiryValues, help?: string) => ({
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": [help, errors[key] ? `iq-${key}-error` : null].filter(Boolean).join(" ") || undefined,
  });
  const select = (key: "relationship" | "inquiryType" | "serviceType" | "timeframe", text: string, required: boolean, options: readonly { value: string; label: string }[]) => (
    <div className="flex flex-col gap-1.5">
      {labelFor(`iq-${key}`, text, required)}
      <select id={`iq-${key}`} className={`${FIELD} ${err(errors[key])}`} value={values[key]} onChange={(e) => set(key, e.target.value)} aria-required={required || undefined} {...aria(key)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {fieldError(key)}
    </div>
  );

  return shell(
    <>
      <header className="mb-6 flex flex-col gap-1.5">
        <p className="text-sm font-medium text-accent-strong">{org}</p>
        <h1 className={mode === "hosted" ? "text-2xl font-semibold tracking-tight sm:text-3xl" : "text-xl font-semibold"}>{form.headline}</h1>
        {form.introText && <p className="whitespace-pre-line text-base text-neutral-700">{form.introText}</p>}
        <p className="text-sm text-neutral-600">{INQUIRY_COPY.notABooking}</p>
      </header>
      <form onSubmit={onSubmit} noValidate aria-busy={sending || undefined} data-testid="public-inquiry-form" className="flex flex-col gap-5">
        <div ref={summaryRef} tabIndex={-1} role="alert" data-testid="public-inquiry-banner" className={banner ? "rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900 outline-none" : "sr-only"}>
          {banner && (
            <>
              <p className="font-medium">{banner.text}</p>
              {errorList.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {errorList.map(([key, message]) => (
                    <li key={key}><a href={`#iq-${key}`} className="underline" onClick={(e) => { e.preventDefault(); document.getElementById(`iq-${key}`)?.focus(); }}>{message}</a></li>
                  ))}
                </ul>
              )}
              {banner.reload && (
                <button type="button" onClick={() => window.location.reload()} className="mt-2 rounded-md border border-red-700 px-3 py-1.5 text-sm font-medium">Reload the form</button>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {labelFor("iq-name", "Your name", true)}
          <input id="iq-name" className={`${FIELD} ${err(errors.name)}`} value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={INQUIRY_LIMITS.name} autoComplete="name" aria-required {...aria("name")} />
          {fieldError("name")}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-neutral-900">How can we reach you? <span className="font-normal text-neutral-500">Give a phone number, an email, or both.</span></legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              {labelFor("iq-phone", "Phone", false)}
              <input id="iq-phone" type="tel" inputMode="tel" className={`${FIELD} ${err(errors.phone)}`} value={values.phone} onChange={(e) => set("phone", e.target.value)} maxLength={INQUIRY_LIMITS.phone} autoComplete="tel" {...aria("phone")} />
              {fieldError("phone")}
            </div>
            <div className="flex flex-col gap-1.5">
              {labelFor("iq-email", "Email", false)}
              <input id="iq-email" type="email" className={`${FIELD} ${err(errors.email)}`} value={values.email} onChange={(e) => set("email", e.target.value)} maxLength={INQUIRY_LIMITS.email} autoComplete="email" {...aria("email")} />
              {fieldError("email")}
            </div>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5" {...aria("preferredReply")}>
          <legend className="mb-1.5 text-sm font-medium text-neutral-900">How should we reply?</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {PREFERRED_REPLY_OPTIONS.map((o, i) => (
              <label key={o.value} className="flex items-center gap-2 text-sm text-neutral-900">
                <input id={i === 0 ? "iq-preferredReply" : undefined} type="radio" name="preferredReply" value={o.value} className="size-4 accent-action-primary-background" checked={values.preferredReply === o.value} onChange={() => set("preferredReply", o.value)} />
                {o.label}
              </label>
            ))}
          </div>
          {fieldError("preferredReply")}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {select("inquiryType", "What's your question about?", true, INQUIRY_TYPE_OPTIONS)}
          {select("relationship", "Who is the transportation for?", false, RELATIONSHIP_OPTIONS)}
          {form.services.length > 0 && select("serviceType", "Service", false, form.services)}
          {select("timeframe", "When might you need it?", false, TIMEFRAME_OPTIONS)}
        </div>

        <div className="flex flex-col gap-1.5">
          {labelFor("iq-question", "Your question", true)}
          <textarea id="iq-question" rows={4} className={`${FIELD} ${err(errors.question)}`} value={values.question} onChange={(e) => set("question", e.target.value)} maxLength={INQUIRY_LIMITS.question} aria-required {...aria("question", "iq-question-help")} />
          <span id="iq-question-help" className="flex justify-between gap-4 text-xs text-neutral-600">
            <span>{INQUIRY_COPY.privacy(org)}</span>
            <span aria-hidden className="shrink-0 tabular-nums">{values.question.length}/{INQUIRY_LIMITS.question}</span>
          </span>
          {fieldError("question")}
        </div>

        <fieldset className="flex flex-col gap-2.5 rounded-md bg-neutral-50 p-4" data-testid="public-inquiry-consent">
          <legend className="sr-only">{INQUIRY_COPY.consentLegend}</legend>
          <p aria-hidden className="text-xs font-medium uppercase tracking-wide text-neutral-500">{INQUIRY_COPY.consentLegend}</p>
          <label className="flex items-start gap-2.5 text-sm text-neutral-800">
            <input id="iq-consentFollowup" type="checkbox" className="mt-0.5 size-4 accent-action-primary-background" checked={values.consentFollowup} onChange={(e) => set("consentFollowup", e.target.checked)} />
            <span>{INQUIRY_COPY.consentFollowup(org)}</span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-neutral-800">
            <input id="iq-consentMarketing" type="checkbox" className="mt-0.5 size-4 accent-action-primary-background" checked={values.consentMarketing} onChange={(e) => set("consentMarketing", e.target.checked)} />
            <span>{INQUIRY_COPY.consentMarketing(org)}</span>
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={sending}
          aria-disabled={sending}
          data-testid="public-inquiry-submit"
          className="self-start rounded-md bg-action-primary-background px-6 py-3 text-base font-medium text-action-primary-foreground hover:bg-action-primary-hover focus:outline-none focus:ring-2 focus:ring-action-primary-background/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? INQUIRY_COPY.sending : INQUIRY_COPY.submit}
        </button>
      </form>
    </>,
  );
}

"use client";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";
import { recordConsentAction, type ContactActionState } from "@/app/operations/growth/contacts/actions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { Panel } from "@/components/ui/Panel";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import { NO_MEDICAL_DETAILS_NOTICE, formatContactTime } from "@/lib/plus/contacts-core";
import {
  CONSENT_CHANNELS,
  CONSENT_DNC_DESCRIPTION,
  CONSENT_DNC_SYSTEM_NOTE,
  CONSENT_DNC_TITLE,
  CONSENT_EMPTY_DESCRIPTION,
  CONSENT_EMPTY_TITLE,
  CONSENT_LIMITS,
  CONSENT_PANEL_DESCRIPTION,
  CONSENT_PREFERRED_CHANNEL_NOTE,
  CONSENT_PURPOSES,
  CONSENT_READ_ONLY_NOTE,
  CONSENT_SELF_CONFIRMATION,
  STAFF_CAPTURE_METHODS,
  captureMethodLabel,
  consentChannelLabel,
  consentEventLabel,
  consentPairKey,
  consentPurposeDescription,
  consentPurposeLabel,
  consentStateBadge,
  earliestCaptureDate,
  formatConsentDate,
  type ConsentChannel,
  type ConsentMode,
  type ConsentPurpose,
} from "@/lib/plus/consents-core";
import type { ConsentEvent, ConsentStateRow } from "@/lib/plus/consents";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: ContactActionState = { status: "idle" };

interface DialogIntent {
  mode: ConsentMode;
  /** Fixed channel / purpose (per-cell revoke and corrections); null = staff choose. */
  pair: { channel: ConsentChannel; purpose: ConsentPurpose } | null;
  /** The pair's latest entry being corrected. */
  corrects: ConsentEvent | null;
}

function ConsentDialog({
  intent,
  organizationId,
  contactId,
  contactName,
  hasEmail,
  hasPhone,
  todayKey,
  onClose,
  onDone,
}: {
  intent: DialogIntent;
  organizationId: string;
  contactId: string;
  contactName: string;
  hasEmail: boolean;
  hasPhone: boolean;
  todayKey: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // ONE idempotency key per dialog (one intended entry): a retry of this submit reuses it, so a double submit or a
  // retry after an ambiguous failure never records the entry twice (the database returns changed=false).
  const [idempotencyKey] = useState(() => `consent-${crypto.randomUUID()}`);
  const [state, action, pending] = useActionState(recordConsentAction, IDLE);
  const [channel, setChannel] = useState<string>(intent.pair?.channel ?? "");
  const [purpose, setPurpose] = useState<string>(intent.pair?.purpose ?? "");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  const grant = intent.mode === "grant";
  const correction = intent.corrects !== null;
  const hasAddress = (c: string) => (c === "email" ? hasEmail : hasPhone);
  const valid =
    !!channel && !!purpose && !!method && (!grant || (confirmed && hasAddress(channel))) && (!correction || note.trim().length > 0);
  const pairLabel = intent.pair ? `${consentChannelLabel(intent.pair.channel)} · ${consentPurposeLabel(intent.pair.purpose)}` : "";
  const title = correction
    ? `Correct an entry — ${pairLabel}`
    : grant
      ? `Record consent — ${contactName}`
      : intent.pair
        ? `Record revocation — ${pairLabel}`
        : `Record revocation — ${contactName}`;
  const description = correction
    ? `The earlier entry stays in the history, marked as corrected. Record what this person actually told your team. ${grant ? "" : "This records a revocation."}`.trim()
    : grant
      ? "Record what this person told your team. A recorded consent isn't permission to send, and Nemryn sends nothing."
      : "Revoking keeps the history. It takes effect immediately.";

  return (
    <Dialog open onClose={onClose} title={title} description={description} className="max-h-[92vh] max-w-xl overflow-y-auto">
      <form action={action} className="flex flex-col gap-zw-md" data-testid="consent-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="mode" value={intent.mode} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {intent.corrects && <input type="hidden" name="correctsConsentId" value={intent.corrects.id} />}
        {intent.pair ? (
          <>
            <input type="hidden" name="channel" value={intent.pair.channel} />
            <input type="hidden" name="purpose" value={intent.pair.purpose} />
            <p className={cn(typography.bodySmall, "text-text-primary")} data-testid="consent-dialog-pair">
              <span className="font-medium">Channel and purpose:</span> {pairLabel}
            </p>
          </>
        ) : (
          <>
            <RadioGroup
              legend="Channel"
              name="channel"
              required
              value={channel}
              onChange={setChannel}
              disabled={pending}
              options={CONSENT_CHANNELS.map((c) => ({
                value: c,
                label: consentChannelLabel(c),
                disabled: grant && !hasAddress(c),
                description: grant && !hasAddress(c) ? (c === "email" ? "No email address on this contact." : "No phone number on this contact.") : undefined,
              }))}
            />
            <RadioGroup
              legend="Purpose"
              name="purpose"
              required
              value={purpose}
              onChange={setPurpose}
              disabled={pending}
              options={CONSENT_PURPOSES.map((p) => ({ value: p, label: consentPurposeLabel(p), description: consentPurposeDescription(p) }))}
            />
          </>
        )}
        <RadioGroup
          legend="How did they tell you?"
          name="method"
          required
          value={method}
          onChange={setMethod}
          disabled={pending}
          options={STAFF_CAPTURE_METHODS.map((m) => ({ value: m, label: captureMethodLabel(m) }))}
        />
        <Input
          name="capturedDate"
          label="Date they told you"
          type="date"
          defaultValue={todayKey}
          min={earliestCaptureDate(todayKey)}
          max={todayKey}
          disabled={pending}
          helpText="Within the last year. Today is recorded as now."
          data-testid="consent-date"
        />
        <Textarea
          name="note"
          label={correction ? "What was wrong (required)" : "Note (optional)"}
          required={correction}
          rows={3}
          maxLength={CONSENT_LIMITS.note}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={pending}
          helpText={NO_MEDICAL_DETAILS_NOTICE}
          data-testid="consent-note"
        />
        {grant && (
          <Checkbox
            name="confirmed"
            label={CONSENT_SELF_CONFIRMATION}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={pending}
            data-testid="consent-confirm"
          />
        )}
        {state.status === "error" && state.message && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="consent-error">
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending || !valid} data-testid="consent-submit">
            {correction ? "Record correction" : grant ? "Record consent" : "Record revocation"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function stateMeta(row: ConsentStateRow, timezone: string): string {
  if (!row.latestConsentId) return "";
  return [
    row.capturedVia ? captureMethodLabel(row.capturedVia) : null,
    formatConsentDate(row.capturedAt, timezone),
    row.recordedByName ? `by ${row.recordedByName}` : null,
    row.isCorrection ? "correction" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Communication preferences (NP-P2-S6-B). Shows the six channel / purpose cells (recorded state -> effective state), the
 * Do-not-contact warning and the append-only history; offers Record consent / Record revocation / Correct only when the
 * server resolved the matching capability. A recorded consent is evidence, never permission -- the copy never says
 * otherwise, and Nemryn sends nothing.
 */
export function ConsentPreferences({
  organizationId,
  contactId,
  contactName,
  hasEmail,
  hasPhone,
  doNotContact,
  archived,
  canGrant,
  canRevoke,
  canEditContact,
  plusReadOnly,
  rows,
  history,
  historyPage,
  historyOpen,
  pageSize,
  timezone,
  todayKey,
}: {
  organizationId: string;
  contactId: string;
  contactName: string;
  hasEmail: boolean;
  hasPhone: boolean;
  doNotContact: boolean;
  archived: boolean;
  canGrant: boolean;
  canRevoke: boolean;
  canEditContact: boolean;
  plusReadOnly: boolean;
  rows: ConsentStateRow[] | null;
  history: { rows: ConsentEvent[]; total: number } | null;
  historyPage: number;
  historyOpen: boolean;
  pageSize: number;
  timezone: string;
  todayKey: string;
}) {
  const [intent, setIntent] = useState<DialogIntent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const close = useCallback(() => setIntent(null), []);
  const onDone = useCallback((message: string) => setNotice(message || null), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  const byPair = useMemo(() => new Map((rows ?? []).map((r) => [consentPairKey(r.channel, r.purpose), r])), [rows]);
  const latestIds = useMemo(() => new Set((rows ?? []).map((r) => r.latestConsentId).filter(Boolean) as string[]), [rows]);
  const correctedIds = useMemo(() => new Set((history?.rows ?? []).map((e) => e.correctsConsentId).filter(Boolean) as string[]), [history]);
  const nothingRecorded = rows !== null && rows.every((r) => r.recordedStatus === "none");
  const pages = history ? Math.max(1, Math.ceil(history.total / pageSize)) : 1;
  const open = (next: DialogIntent) => {
    setNotice(null);
    setIntent(next);
  };
  // A correction records the opposite of the wrong entry; it must pass the same rules as any grant / revocation.
  const canCorrect = (e: ConsentEvent) =>
    latestIds.has(e.id) && e.capturedVia !== "do_not_contact" && (e.status === "granted" ? canRevoke : canGrant);

  const revokeButton = (row: ConsentStateRow) =>
    canRevoke && row.recordedStatus === "granted" ? (
      <Button
        type="button"
        size="sm"
        variant="text"
        onClick={() => open({ mode: "revoke", pair: { channel: row.channel as ConsentChannel, purpose: row.purpose as ConsentPurpose }, corrects: null })}
        aria-label={`Revoke ${consentPurposeLabel(row.purpose).toLowerCase()} consent for ${consentChannelLabel(row.channel).toLowerCase()}`}
        data-testid={`consent-revoke-${row.channel}-${row.purpose}`}
      >
        Revoke
      </Button>
    ) : null;

  const cell = (row: ConsentStateRow | undefined, testid: string) => {
    if (!row) return null;
    const badge = consentStateBadge(row.recordedStatus, row.effectiveStatus);
    const meta = stateMeta(row, timezone);
    return (
      <div className="flex flex-col items-start gap-1" data-testid={testid} data-recorded={row.recordedStatus} data-effective={row.effectiveStatus}>
        <StatusBadge label={badge.label} category={badge.category} />
        {meta && <span className={cn(typography.metadata, "text-text-secondary")}>{meta}</span>}
        {revokeButton(row)}
      </div>
    );
  };

  return (
    <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="contact-consents" id="contact-consents">
      <SectionHeader
        title="Communication preferences"
        description={CONSENT_PANEL_DESCRIPTION}
        icon={<ChatCircleText />}
        tone="accent"
        actions={
          canGrant || canRevoke ? (
            <div className="flex flex-wrap gap-2">
              {canGrant && (
                <Button type="button" size="sm" variant="outline" onClick={() => open({ mode: "grant", pair: null, corrects: null })} data-testid="consent-record">
                  Record consent
                </Button>
              )}
              {canRevoke && (
                <Button type="button" size="sm" variant="outline" onClick={() => open({ mode: "revoke", pair: null, corrects: null })} data-testid="consent-record-revocation">
                  Record revocation
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {doNotContact && (
        <div data-testid="consent-dnc-warning">
          <AttentionState
            level="warning"
            title={CONSENT_DNC_TITLE}
            description={CONSENT_DNC_DESCRIPTION}
            action={
              canEditContact ? (
                <LinkButton href={`/operations/growth/contacts/${contactId}/edit`} variant="outline" size="sm">
                  Edit contact
                </LinkButton>
              ) : undefined
            }
          />
        </div>
      )}
      {plusReadOnly && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="consent-read-only">
          {CONSENT_READ_ONLY_NOTE}
        </p>
      )}
      {!plusReadOnly && !canRevoke && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="consent-view-only">
          You can view communication preferences but not change them.
        </p>
      )}
      {archived && canRevoke && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="consent-archived-note">
          This contact is archived. Revocations can still be recorded; new consent can&apos;t.
        </p>
      )}
      {notice && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="consent-notice">
          {notice}
        </p>
      )}

      {rows === null ? (
        <AttentionState level="critical" title="Communication preferences couldn't be loaded" description="Reload the page to try again." />
      ) : nothingRecorded && !doNotContact ? (
        <EmptyState icon={<ChatCircleText />} title={CONSENT_EMPTY_TITLE} description={CONSENT_EMPTY_DESCRIPTION} size="compact" />
      ) : (
        <>
          {/* A semantic table (rows = channels, columns = purposes). Operations renders only from tablet width (md) up --
              below it the shell shows its approved "tablet and desktop" notice -- and the table fits at 768. */}
          <table className="w-full border-collapse text-left" data-testid="consent-table">
            <caption className="sr-only">Current communication preferences</caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th scope="col" className={cn(typography.label, "py-2 pr-4 text-text-secondary")}>
                  Channel
                </th>
                {CONSENT_PURPOSES.map((p) => (
                  <th key={p} scope="col" className={cn(typography.label, "py-2 pr-4 text-text-secondary")}>
                    {consentPurposeLabel(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONSENT_CHANNELS.map((c) => (
                <tr key={c} className="border-b border-border-subtle last:border-b-0">
                  <th scope="row" className={cn(typography.label, "py-3 pr-4 align-top text-text-primary")}>
                    {consentChannelLabel(c)}
                  </th>
                  {CONSENT_PURPOSES.map((p) => (
                    <td key={p} className="py-3 pr-4 align-top">
                      {cell(byPair.get(consentPairKey(c, p)), `consent-cell-${c}-${p}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className={cn(typography.metadata, "text-text-muted")}>{CONSENT_PREFERRED_CHANNEL_NOTE}</p>

      {history !== null && history.total > 0 && (
        <details open={historyOpen} className="border-t border-border-subtle pt-zw-sm" data-testid="consent-history">
          <summary className={cn(typography.label, "cursor-pointer text-text-primary")}>History ({history.total})</summary>
          <ol aria-label="Consent history" className="mt-zw-sm" data-testid="consent-history-list">
            {history.rows.map((e) => (
              <li key={e.id} className="border-t border-border-subtle py-zw-sm first:border-t-0" data-testid="consent-event" data-status={e.status} data-method={e.capturedVia}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className={cn(typography.label, "text-text-primary")}>
                    {consentChannelLabel(e.channel)} · {consentPurposeLabel(e.purpose)} · {consentEventLabel(e.status)}
                  </span>
                  <span className={cn(typography.metadata, "text-text-muted")}>
                    recorded {formatContactTime(e.recordedAt, timezone)}
                    {e.recordedByName ? ` by ${e.recordedByName}` : ""}
                  </span>
                </div>
                <p className={cn(typography.metadata, "mt-0.5 text-text-secondary")}>
                  {captureMethodLabel(e.capturedVia)} · {formatConsentDate(e.capturedAt, timezone)}
                  {e.correctsConsentId ? " · Corrects an earlier entry" : ""}
                  {correctedIds.has(e.id) ? " · Corrected" : ""}
                </p>
                {e.capturedVia === "do_not_contact" && (
                  <p className={cn(typography.metadata, "mt-0.5 text-text-secondary")}>{CONSENT_DNC_SYSTEM_NOTE}</p>
                )}
                {e.evidenceNote && <p className={cn(typography.bodySmall, "mt-1 whitespace-pre-wrap break-words text-text-primary")}>{e.evidenceNote}</p>}
                {canCorrect(e) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="text"
                    className="mt-1"
                    onClick={() =>
                      open({ mode: e.status === "granted" ? "revoke" : "grant", pair: { channel: e.channel as ConsentChannel, purpose: e.purpose as ConsentPurpose }, corrects: e })
                    }
                    aria-label={`Correct this entry: ${consentChannelLabel(e.channel)}, ${consentPurposeLabel(e.purpose)}, recorded in error`}
                    data-testid="consent-correct"
                  >
                    This entry was recorded in error
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {pages > 1 && (
            <nav aria-label="Consent history pages" className="mt-zw-sm flex flex-wrap items-center gap-2">
              {historyPage > 1 && (
                <LinkButton href={`?consentHistory=${historyPage - 1}#contact-consents`} variant="outline" size="sm" scroll={false}>
                  Newer entries
                </LinkButton>
              )}
              <span className={cn(typography.metadata, "text-text-secondary")}>
                Page {historyPage} of {pages}
              </span>
              {historyPage < pages && (
                <LinkButton href={`?consentHistory=${historyPage + 1}#contact-consents`} variant="outline" size="sm" scroll={false} data-testid="consent-history-older">
                  Older entries
                </LinkButton>
              )}
            </nav>
          )}
        </details>
      )}

      {intent && (
        <ConsentDialog
          intent={intent}
          organizationId={organizationId}
          contactId={contactId}
          contactName={contactName}
          hasEmail={hasEmail}
          hasPhone={hasPhone}
          todayKey={todayKey}
          onClose={close}
          onDone={onDone}
        />
      )}
    </Panel>
  );
}

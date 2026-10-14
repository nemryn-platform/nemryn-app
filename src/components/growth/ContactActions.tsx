"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { archiveContactAction, logContactActivityAction, type ContactActionState } from "@/app/operations/growth/contacts/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  CONTACT_LIMITS,
  LOGGABLE_ACTIVITY_TYPES,
  LOGGING_IS_NOT_SENDING_NOTICE,
  NO_MEDICAL_DETAILS_NOTICE,
  logActionLabel,
  type LoggableActivityType,
} from "@/lib/plus/contacts-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: ContactActionState = { status: "idle" };

function LogActivityDialog({
  type,
  contactId,
  contactName,
  organizationId,
  onClose,
  onDone,
}: {
  type: LoggableActivityType;
  contactId: string;
  contactName: string;
  organizationId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [state, action, pending] = useActionState(logContactActivityAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog open onClose={onClose} title={`${logActionLabel(type)} — ${contactName}`} description={type === "note" ? NO_MEDICAL_DETAILS_NOTICE : `${LOGGING_IS_NOT_SENDING_NOTICE} ${NO_MEDICAL_DETAILS_NOTICE}`}>
      <form action={action} className="flex flex-col gap-zw-md" data-testid="activity-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="activityType" value={type} />
        <Textarea name="body" label={type === "note" ? "Note" : "Summary"} required rows={4} maxLength={CONTACT_LIMITS.body} disabled={pending} />
        {type !== "note" && (
          <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
            <Input name="occurredDate" label="Date (optional)" type="date" disabled={pending} helpText="Leave empty for now." />
            <Input name="occurredTime" label="Time (optional)" type="time" disabled={pending} />
          </div>
        )}
        {state.status === "error" && state.message && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending} data-testid="activity-save">
            {type === "note" ? "Add note" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ArchiveDialog({
  contactId,
  contactName,
  organizationId,
  expectedVersion,
  onClose,
  onDone,
}: {
  contactId: string;
  contactName: string;
  organizationId: string;
  expectedVersion: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [state, action, pending] = useActionState(archiveContactAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Archive ${contactName}?`}
      description="Archived contacts are hidden from the active list and become read-only. Nothing is deleted: the contact and its whole timeline are kept."
    >
      <form action={action} className="flex flex-col gap-zw-md" data-testid="archive-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="expectedVersion" value={expectedVersion} />
        <Textarea name="reason" label="Reason (optional)" rows={2} maxLength={CONTACT_LIMITS.archiveReason} disabled={pending} helpText={NO_MEDICAL_DETAILS_NOTICE} />
        {state.status === "error" && state.message && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending} data-testid="archive-confirm">
            Archive contact
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Write actions on Contact detail (NP-P1-S4). Rendered ONLY when the server resolved Plus write capability for the
 * signed-in person and the contact is active -- a read-only viewer never receives these controls. The database
 * re-checks every action regardless.
 */
export function ContactWriteActions({
  contactId,
  contactName,
  organizationId,
  expectedVersion,
}: {
  contactId: string;
  contactName: string;
  organizationId: string;
  expectedVersion: string;
}) {
  const [logType, setLogType] = useState<LoggableActivityType | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeLog = useCallback(() => setLogType(null), []);
  const closeArchive = useCallback(() => setArchiving(false), []);
  const onDone = useCallback((message: string) => setNotice(message || null), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" data-testid="contact-log-actions">
        {LOGGABLE_ACTIVITY_TYPES.map((type) => (
          <Button key={type} type="button" size="sm" variant={type === "note" ? "primary" : "outline"} onClick={() => { setNotice(null); setLogType(type); }} data-testid={`log-${type}`}>
            {logActionLabel(type)}
          </Button>
        ))}
        <Button type="button" size="sm" variant="text" onClick={() => { setNotice(null); setArchiving(true); }} data-testid="contact-archive">
          Archive contact
        </Button>
      </div>
      {notice && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="contact-notice">
          {notice}
        </p>
      )}
      {logType && (
        <LogActivityDialog type={logType} contactId={contactId} contactName={contactName} organizationId={organizationId} onClose={closeLog} onDone={onDone} />
      )}
      {archiving && (
        <ArchiveDialog contactId={contactId} contactName={contactName} organizationId={organizationId} expectedVersion={expectedVersion} onClose={closeArchive} onDone={onDone} />
      )}
    </div>
  );
}

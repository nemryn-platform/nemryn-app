import { getContactConsents, listContactConsentEvents, type ConsentEvent, type ConsentStateRow } from "@/lib/plus/consents";
import { CONSENT_LIMITS } from "@/lib/plus/consents-core";
import { localDateKeyOf } from "@/lib/operations/local-time-core";
import { ConsentPreferences } from "@/components/growth/ConsentPreferences";

/**
 * Contact detail -> Communication preferences (NP-P2-S6-B; design section 5). Server component: reads the six-cell state
 * (plus_get_contact_consents) and one page of history (plus_list_contact_consent_events), both Plus read, re-checked by
 * the database. Neither returns the address digest or idempotency key. Write controls are offered only with Plus write
 * capability; every write still goes through the RPCs, which decide (read_only, Do not contact, archived, corrections).
 */
export async function ContactConsentsPanel({
  organizationId,
  timezone,
  contact,
  canWritePlus,
  plusReadOnly,
  historyPage,
}: {
  organizationId: string;
  timezone: string;
  contact: { id: string; displayName: string; phone: string | null; email: string | null; doNotContact: boolean; archived: boolean };
  /** Plus write entitlement AND write capability (not limited by the contact's archived state). */
  canWritePlus: boolean;
  plusReadOnly: boolean;
  /** 1-based history page from the URL; null keeps the history collapsed. */
  historyPage: number | null;
}) {
  let rows: ConsentStateRow[] | null = null;
  let history: { rows: ConsentEvent[]; total: number } | null = null;
  let page = historyPage ?? 1;
  try {
    [rows, history] = await Promise.all([
      getContactConsents(organizationId, contact.id),
      listContactConsentEvents(organizationId, contact.id, page),
    ]);
    // a page past the end (e.g. a stale link) falls back to the newest page rather than hiding the history
    if (history.rows.length === 0 && page > 1) {
      page = 1;
      history = await listContactConsentEvents(organizationId, contact.id, 1);
    }
  } catch {
    rows = null;
    history = null;
  }
  // Approved write rules (ZD-235, ZD-233, ZD-239): revocations need Plus write (archived contacts allowed); a grant also
  // needs an active contact and Do not contact off. The RPC enforces the same rules regardless of what is offered here.
  const canRevoke = canWritePlus;
  const canGrant = canWritePlus && !contact.archived && !contact.doNotContact;
  return (
    <ConsentPreferences
      organizationId={organizationId}
      contactId={contact.id}
      contactName={contact.displayName}
      hasEmail={!!contact.email}
      hasPhone={!!contact.phone && /\d/.test(contact.phone)}
      doNotContact={contact.doNotContact}
      archived={contact.archived}
      canGrant={canGrant}
      canRevoke={canRevoke}
      canEditContact={canWritePlus && !contact.archived}
      plusReadOnly={plusReadOnly}
      rows={rows}
      history={history}
      historyPage={page}
      historyOpen={historyPage !== null}
      pageSize={CONSENT_LIMITS.historyPageSize}
      timezone={timezone}
      todayKey={localDateKeyOf(new Date().getTime(), timezone)}
    />
  );
}

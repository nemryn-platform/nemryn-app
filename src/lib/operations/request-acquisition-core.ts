/**
 * Pure presentation helpers for a Request's ACQUISITION snapshot (P1-PILOT-S4C) -- no runtime imports,
 * unit-testable under plain Node. The snapshot is factual evidence captured with the original website
 * submission; this module only turns it into restrained display rows. It never derives or guesses a
 * classification (paid / organic / social / direct): absent facts stay absent.
 */

/** Read-model shape of one snapshot (camelCase; mirrors get_request_acquisition). Every field optional. */
export interface RequestAcquisition {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingPath: string | null;
  submissionPath: string | null;
  referrerHost: string | null;
  formVersion: string | null;
}

export interface AcquisitionRow {
  label: string;
  value: string;
}

/** Display order and labels (brief section 17). Values are plain text -- never HTML, never links. */
const FIELDS: { key: keyof RequestAcquisition; label: string }[] = [
  { key: "utmSource", label: "Source" },
  { key: "utmMedium", label: "Medium" },
  { key: "utmCampaign", label: "Campaign" },
  { key: "utmContent", label: "Content" },
  { key: "utmTerm", label: "Search term" },
  { key: "landingPath", label: "Landing page" },
  { key: "submissionPath", label: "Submitted from" },
  { key: "referrerHost", label: "Referrer" },
  { key: "formVersion", label: "Form version" },
];

/** The rows to show, in a stable order, skipping every absent value. Empty array => show nothing at all. */
export function describeAcquisition(acquisition: RequestAcquisition | null | undefined): AcquisitionRow[] {
  if (!acquisition) return [];
  const rows: AcquisitionRow[] = [];
  for (const { key, label } of FIELDS) {
    const value = acquisition[key];
    if (typeof value === "string" && value.trim().length > 0) rows.push({ label, value });
  }
  return rows;
}

/** Row shape returned by get_request_acquisition (snake_case) -> the read model, or null when the RPC returned no row. */
export function acquisitionFromRpcRow(
  row: {
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    landing_path: string | null;
    submission_path: string | null;
    referrer_host: string | null;
    form_version: string | null;
  } | null | undefined,
): RequestAcquisition | null {
  if (!row) return null;
  const acquisition: RequestAcquisition = {
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    utmContent: row.utm_content,
    utmTerm: row.utm_term,
    landingPath: row.landing_path,
    submissionPath: row.submission_path,
    referrerHost: row.referrer_host,
    formVersion: row.form_version,
  };
  return describeAcquisition(acquisition).length > 0 ? acquisition : null;
}

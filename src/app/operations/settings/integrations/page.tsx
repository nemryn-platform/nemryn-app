import { redirect } from "next/navigation";

/**
 * Backward compatibility (P1-COMM-D1): "Integrations" only ever held website intake, which is now Settings -> Website
 * Requests. Old bookmarks and links keep working; authorization is enforced by the destination page.
 */
export default function LegacyIntegrationsSettingsRedirect(): never {
  redirect("/operations/settings/website-requests");
}

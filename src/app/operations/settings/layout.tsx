import type { ReactNode } from "react";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { SETTINGS_SECTIONS } from "@/lib/operations/settings-sections";
import { SettingsSubNav } from "@/components/operations/settings/SettingsSubNav";

/**
 * NP-UI-V2-3 / D-13: the Settings sub-navigation frame (layout only). The same context resolution the Operations layout
 * already performs; it grants nothing. Only an Organization Admin -- who can open every listed section -- gets the
 * frame; anyone else who reaches a Settings page they may open (e.g. My Access) sees that page exactly as before, so
 * no admin-only destination is advertised to them. Every page keeps its own guard.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = await getCurrentPathname("/operations/settings");
  const organization = await requireOperationsAccess(pathname);
  if (organization.role !== "organization_admin") return children;
  return (
    <SettingsSubNav sections={SETTINGS_SECTIONS.map(({ slug, title, available }) => ({ slug, title, available }))}>{children}</SettingsSubNav>
  );
}

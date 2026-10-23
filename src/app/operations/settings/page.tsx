import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { SETTINGS_SECTIONS } from "@/lib/operations/settings-sections";
import { settingsIcons } from "@/design/icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { iconCircleClasses, iconToneClasses } from "@/components/ui/Panel";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Settings" };

/**
 * Settings home (P1-PILOT-S4B-R4A) -- the tenant administration landing
 * surface. Organization Admin only (guarded here; the mutations behind each
 * section guard themselves independently). Sections whose pages do not
 * exist yet are shown, quietly, as not-yet-available rather than linked --
 * see settings-sections.ts.
 */
export default async function SettingsHomePage() {
  const pathname = await getCurrentPathname("/operations/settings");
  await requireOrganizationAdminAccess(pathname);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader title="Settings" description="Configure how your organization operates in Nemryn." />

      <ul className="grid grid-cols-1 gap-zw-md md:grid-cols-2 xl:grid-cols-3">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = settingsIcons[section.slug];
          const body = (
            <>
              {/* NP-UI-V2-3: the Brand Lock v2 40px icon circle (mint for an available section). */}
              <span className={cn(iconCircleClasses.md, section.available ? iconToneClasses.accent : iconToneClasses.neutral)}>
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn(typography.subsectionHeading, "pt-0.5", section.available ? "text-text-primary" : "text-text-secondary")}>
                  {section.title}
                </span>
                <span className={cn(typography.bodySmall, "text-text-secondary")}>{section.description}</span>
                {!section.available && <span className={cn(typography.metadata, "mt-1 text-text-muted")}>Not yet available</span>}
              </span>
              {section.available && <ArrowRight className="mt-1 size-4 shrink-0 text-text-muted" aria-hidden />}
            </>
          );
          const shared = "flex h-full items-start gap-3 rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm";
          return (
            <li key={section.slug}>
              {section.available ? (
                <Link
                  href={`/operations/settings/${section.slug}`}
                  className={cn(shared, "transition-colors duration-base hover:border-accent-hover-border motion-reduce:transition-none")}
                >
                  {body}
                </Link>
              ) : (
                <div className={shared} aria-disabled="true">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { Buildings } from "@phosphor-icons/react/dist/ssr";
import { selectOrganizationAction } from "@/app/select-organization/actions";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import type { ActiveMembership } from "@/lib/auth/types";

const ROLE_LABEL: Record<ActiveMembership["role"], string> = {
  organization_admin: "Organization Admin",
  dispatcher: "Dispatcher",
  driver: "Driver",
};

export interface OrganizationSelectorProps {
  memberships: ActiveMembership[];
  next?: string;
  /** P1-UX-R1A: display-only — marks the membership the caller is already using with a restrained "Current" badge, purely so an explicit switch shows which workspace is active. Never affects which membership a click selects; that stays a plain, independent server-validated submission per card. `null`/omitted (the ordinary select-required case, e.g. right after sign-in with no prior selection) simply renders no badge. */
  currentOrganizationId?: string | null;
}

/**
 * The smallest safe MVP org switcher (work item §20-21, docs/product/
 * application-route-map.md "Multi-org UX"): a plain list of the caller's
 * own active Memberships (name + role only, no internal tenant metadata),
 * each its own server-validated form submission — not a designed org-
 * switcher component. Native radio-button semantics, no client JS
 * required for the core flow.
 */
export function OrganizationSelector({ memberships, next, currentOrganizationId }: OrganizationSelectorProps) {
  return (
    <div className="flex flex-col gap-3">
      {memberships.map((membership) => {
        const isCurrent = membership.organizationId === currentOrganizationId;
        return (
          <form key={membership.organizationId} action={selectOrganizationAction}>
            <input type="hidden" name="organizationId" value={membership.organizationId} />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-sm border border-border-strong bg-surface-elevated p-4 text-left transition-colors hover:border-selection-border hover:bg-brand-calm-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-text-secondary">
                <Buildings className="size-5" aria-hidden />
              </span>
              <span className="flex flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className={cn(typography.body, "font-medium text-text-primary")}>
                    {membership.organizationName}
                  </span>
                  {isCurrent && (
                    <span className={cn(typography.metadata, "rounded-full bg-surface-secondary px-2 py-0.5 text-text-secondary")}>
                      Current
                    </span>
                  )}
                </span>
                <span className={cn(typography.bodySmall, "text-text-muted")}>{ROLE_LABEL[membership.role]}</span>
              </span>
            </button>
          </form>
        );
      })}
    </div>
  );
}

import type { ComponentType } from "react";
import { AddressBook, Buildings, Check, FileText, IdentificationCard, ListChecks, Path, Storefront, UserPlus, Users, Van } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getGettingStarted } from "@/lib/operations/onboarding-checklist";
import { GETTING_STARTED_SCOPE_NOTE, MILESTONES_NOTE, setupStatusText, type GettingStarted, type SetupStep, type SetupStepKey } from "@/lib/operations/getting-started-core";
import { getPlusAccessState } from "@/lib/plus/access";
import { canOpenGrowth } from "@/lib/plus/access-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, iconCircleClasses, iconToneClasses } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LinkButton } from "@/components/ui/LinkButton";
import { AttentionState } from "@/components/ui/AttentionState";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Getting started" };

const ICONS: Record<SetupStepKey, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  business: Storefront,
  services: ListChecks,
  vehicle: Van,
  driver: IdentificationCard,
  facility: Buildings,
  passenger: Users,
  trip: Path,
  team: UserPlus,
  growth_contact: AddressBook,
  growth_quote: FileText,
};

/**
 * Getting started (NP-PILOT-P2) -- every setup step with a plain explanation, its REAL status (getting-started-core:
 * derived from workspace data, never from page visits) and where to do it. Organization Admins and staff with
 * Operations access; admin-only steps show who completes them instead of a link. Growth steps appear only with
 * Nemryn Plus access. Reached from the sidebar (while essentials remain), the Operations Brief banner and empty states.
 */
export default async function GettingStartedPage() {
  const pathname = await getCurrentPathname("/operations/getting-started");
  const organization = await requireOperationsAccess(pathname);
  const isAdmin = organization.role === "organization_admin";

  let setup: GettingStarted | null = null;
  try {
    const plus = await getPlusAccessState(organization.organizationId);
    setup = await getGettingStarted(organization.organizationId, isAdmin, canOpenGrowth(plus.state, plus.capability));
  } catch {
    console.error("[operations] getting started failed to load");
  }

  return (
    <div className="flex flex-col gap-zw-xl" data-testid="getting-started">
      <PageHeader
        title="Getting started"
        description="Four business setup steps get your workspace ready to run rides. Each one is marked complete only when the information is actually saved."
      />

      {setup === null ? (
        <AttentionState level="warning" title="Setup status couldn't be loaded" description="Reload the page in a moment. Nothing about your workspace was changed." />
      ) : (
        <>
          <Panel surface="mint" className="flex flex-col gap-2 p-zw-lg" data-testid="getting-started-summary">
            <p className={cn(typography.subsectionHeading, "text-text-primary")} data-testid="getting-started-count">
              {setup.isComplete ? "Business setup is complete" : `${setup.completedCount} of ${setup.totalCount} business setup steps complete`}
            </p>
            <p className={cn(typography.bodySmall, "text-text-secondary")}>
              {setup.isComplete
                ? "Your business details, services, vehicle and driver are in place. The first-use milestones below are optional."
                : "Work through these in any order. You can come back here at any time from the sidebar while setup is incomplete."}
            </p>
          </Panel>

          <StepGroup
            title="Business setup essentials"
            description="Needed to take requests, dispatch drivers and bill for rides. These four decide whether setup is complete."
            steps={setup.essentials}
            ordered
            testId="getting-started-essentials"
          />
          <StepGroup title="First-use milestones" description={MILESTONES_NOTE} steps={setup.milestones} testId="getting-started-milestones" />
          {setup.steps.some((s) => s.group === "growth") && (
            <StepGroup
              title="Nemryn Plus — Growth (optional)"
              description="Optional steps for the Growth workspace: contacts, follow-ups and private-pay quotes."
              steps={setup.steps.filter((s) => s.group === "growth")}
              testId="getting-started-growth"
            />
          )}
        </>
      )}

      <p className={cn(typography.metadata, "text-text-muted")} data-testid="getting-started-scope-note">
        {GETTING_STARTED_SCOPE_NOTE}
      </p>
    </div>
  );
}

function StepGroup({ title, description, steps, ordered = false, testId }: { title: string; description: string; steps: SetupStep[]; ordered?: boolean; testId: string }) {
  if (steps.length === 0) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <section className="flex flex-col gap-zw-md" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <SectionHeader title={title} description={description} titleId={`${testId}-title`} />
      <List className="flex flex-col gap-zw-sm">
        {steps.map((step) => {
          const Icon = ICONS[step.key];
          const done = step.complete === true;
          return (
            <li
              key={step.key}
              className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm sm:flex-row sm:items-center"
              data-testid="getting-started-step"
              data-step={step.key}
              data-complete={done ? "true" : step.complete === false ? "false" : "unknown"}
            >
              <span className={cn(iconCircleClasses.md, "relative shrink-0", done ? iconToneClasses.accent : iconToneClasses.neutral)} aria-hidden>
                <Icon className="size-5" aria-hidden />
                {done && (
                  <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-surface-elevated bg-success-strong text-white">
                    <Check className="size-2.5" weight="bold" />
                  </span>
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>{step.label}</h3>
                  <StatusBadge label={setupStatusText(step)} category={done ? "completed" : step.complete === false ? "neutral" : "informational"} />
                </div>
                <p className={cn(typography.bodySmall, "text-text-secondary")}>{step.description}</p>
                {step.note && <p className={cn(typography.metadata, "text-text-muted")}>{step.note}</p>}
              </div>
              {step.href && (
                <LinkButton href={step.href} size="sm" variant={done ? "outline" : "primary"} className="shrink-0 self-start sm:self-center" data-testid="getting-started-action">
                  {done ? "Review" : step.actionLabel}
                  <span className="sr-only">{` — ${step.label}`}</span>
                </LinkButton>
              )}
            </li>
          );
        })}
      </List>
    </section>
  );
}

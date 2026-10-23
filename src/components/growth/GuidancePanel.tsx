import type { ReactNode } from "react";
import { Info } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * NP-UI-V2-3 final polish: the side-column guidance beside a Growth form -- a Brand Lock v2 mint panel ("mint = guidance",
 * §1) with an icon header. It carries the form's EXISTING notice text unchanged (same data-testid on the paragraph);
 * it adds no new rule or instruction.
 */
export function GuidancePanel({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Panel surface="mint" className="flex flex-col gap-zw-sm xl:sticky xl:top-0">
      <SectionHeader as="h2" title="Before you save" icon={<Info />} tone="accent" />
      <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid={testId}>
        {children}
      </p>
    </Panel>
  );
}

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { ShellStatePanel } from "@/components/ui/RouteState";
import { LinkButton } from "@/components/ui/LinkButton";

/**
 * Not-found inside the Operations shell (NP-UI-P1a, C2): unknown /operations/* URLs (via the [...missing] catch-all)
 * and notFound() from any Operations / Growth page. The same message for unknown, foreign and inaccessible records.
 */
export default function OperationsNotFound() {
  return (
    <ShellStatePanel
      testId="operations-not-found"
      icon={<MagnifyingGlass className="size-10" aria-hidden />}
      title="Page not found"
      actions={
        <LinkButton href="/operations" variant="outline">
          Back to Operations Brief
        </LinkButton>
      }
    >
      <p>This page could not be found. (404) The link may be out of date, or the record isn&apos;t available in this workspace.</p>
    </ShellStatePanel>
  );
}

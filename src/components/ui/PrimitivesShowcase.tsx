"use client";

import { useRef, useState } from "react";
import { DotsThree, Funnel, Info } from "@phosphor-icons/react/dist/ssr";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Dialog } from "./Dialog";
import { Menu } from "./Menu";
import { Popover } from "./Menu";
import { Pagination } from "./Pagination";
import { RadioGroup } from "./RadioGroup";
import { Skeleton, SkeletonTable, SkeletonText } from "./Skeleton";
import { Switch } from "./Switch";
import { SegmentedControl, Tabs } from "./Tabs";
import { Tooltip } from "./Tooltip";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

/**
 * NP-UI-P1a primitives showcase for the internal /foundation QA harness (fictional sample content only). Also a
 * Dialog focus-return test bench: every close path, plus a dialog whose invoking button disappears after its action.
 */
export function PrimitivesShowcase() {
  const [segment, setSegment] = useState("today");
  const [dialog, setDialog] = useState<null | "basic" | "vanishing">(null);
  const [vanished, setVanished] = useState(false);
  const fallback = useRef<HTMLButtonElement>(null);
  const [lastAction, setLastAction] = useState("none");
  return (
    <div className="flex flex-col gap-zw-lg" data-testid="p1a-primitives">
      <h2 className={cn(typography.sectionHeading, "text-text-primary")}>UI-P1a primitives</h2>
      <div className="grid gap-zw-lg md:grid-cols-2">
        <div className="flex flex-col gap-zw-md" data-testid="p1a-checkbox">
          <Checkbox name="sample-notify" label="Email dispatchers" description="Sample description text." defaultChecked />
          <Checkbox name="sample-disabled" label="Disabled option" disabled />
          <Checkbox name="sample-error" label="Option with an error" error="Choose at least one role." />
        </div>
        <div className="flex flex-col gap-zw-md">
          <RadioGroup legend="Request source" name="sample-source" defaultValue="facility" variant="card" options={[
            { value: "passenger", label: "Passenger", description: "The rider called in." },
            { value: "facility", label: "Healthcare facility", description: "A clinic or hospital." },
            { value: "other", label: "Other", disabled: true },
          ]} />
          <Switch label="Show completed trips" description="Sample switch." name="sample-switch" />
        </div>
      </div>
      <Tabs label="Sample tabs" items={[
        { value: "open", label: "Open", count: 3, panel: <p className={typography.bodySmall}>Open sample panel.</p> },
        { value: "done", label: "Done", count: 12, panel: <p className={typography.bodySmall}>Done sample panel.</p> },
        { value: "archived", label: "Archived", disabled: true, panel: <p>Archived</p> },
        { value: "all", label: "All", panel: <p className={typography.bodySmall}>All sample panel.</p> },
      ]} />
      <div className="flex flex-wrap items-center gap-zw-md">
        <SegmentedControl label="Sample day" value={segment} onValueChange={setSegment} options={[{ value: "today", label: "Today" }, { value: "tomorrow", label: "Tomorrow" }]} />
        <Menu label="Sample actions" trigger={<span className="inline-flex size-9 items-center justify-center rounded-md border border-border-strong"><DotsThree className="size-5" aria-hidden /></span>} items={[
          { label: "Edit", onSelect: () => setLastAction("edit") },
          { label: "Export", onSelect: () => setLastAction("export") },
          { label: "Duplicate", disabled: true },
          { label: "Delete", destructive: true, onSelect: () => setLastAction("delete") },
        ]} />
        <Popover label="Sample filters" trigger={<span className="inline-flex h-9 items-center gap-1 rounded-md border border-border-strong px-3"><Funnel className="size-4" aria-hidden /><span className={typography.label}>Filters</span></span>}>
          <Checkbox name="f-unassigned" label="Unassigned only" />
        </Popover>
        <Tooltip content="Times are shown in the workspace's timezone.">
          <button type="button" aria-label="About times" className="inline-flex size-9 items-center justify-center rounded-md border border-border-strong">
            <Info className="size-4" aria-hidden />
          </button>
        </Tooltip>
        <span className={typography.metadata} data-testid="p1a-last-action">Last action: {lastAction}</span>
      </div>
      <Pagination page={3} totalPages={12} totalItems={290} pageSize={25} hrefForPage={(p) => `/foundation?page=${p}`} />
      <div className="grid gap-zw-md md:grid-cols-2" data-testid="p1a-skeletons">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <SkeletonText lines={3} />
        </div>
        <SkeletonTable rows={3} columns={3} />
      </div>
      <div className="flex flex-wrap items-center gap-zw-md" data-testid="p1a-dialog-bench">
        <Button type="button" variant="outline" onClick={() => setDialog("basic")} data-testid="p1a-dialog-open">
          Open sample dialog
        </Button>
        {!vanished && (
          <Button type="button" variant="outline" onClick={() => setDialog("vanishing")} data-testid="p1a-vanishing-open">
            Open dialog whose trigger disappears
          </Button>
        )}
        <Button ref={fallback} type="button" variant="text" onClick={() => setVanished(false)} data-testid="p1a-fallback-target">
          Reset sample
        </Button>
      </div>
      {dialog === "basic" && (
        <Dialog open title="Sample dialog" description="Fictional content for focus testing." onClose={() => setDialog(null)}>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)} data-testid="p1a-dialog-cancel">
              Cancel
            </Button>
            <Button type="button" onClick={() => setDialog(null)} data-testid="p1a-dialog-confirm">
              Confirm
            </Button>
          </div>
        </Dialog>
      )}
      {dialog === "vanishing" && (
        <Dialog open title="Complete sample action" onClose={() => setDialog(null)} returnFocusRef={fallback}>
          <Button type="button" onClick={() => { setVanished(true); setDialog(null); }} data-testid="p1a-vanishing-confirm">
            Complete
          </Button>
        </Dialog>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Van, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { SearchInput } from "@/components/ui/SearchInput";
import { StatusBadge, type StatusCategory } from "@/components/ui/StatusBadge";
import { TripStatus } from "@/components/ui/TripStatus";
import { DriverStatus } from "@/components/ui/DriverStatus";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SummaryStrip } from "@/components/ui/SummaryStrip";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { AttentionState } from "@/components/ui/AttentionState";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { DriverTripCard } from "@/components/driver/DriverTripCard";
import { DriverTripRow } from "@/components/driver/DriverTripRow";
import { DriverPrimaryAction } from "@/components/driver/DriverPrimaryAction";
import { DriverInstruction } from "@/components/driver/DriverInstruction";
import { DriverRoute } from "@/components/driver/DriverRoute";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const STATUS_CATEGORIES: StatusCategory[] = [
  "neutral",
  "informational",
  "active",
  "positive",
  "warning",
  "critical",
  "completed",
  "cancelled",
];

interface SampleTrip {
  id: string;
  passenger: string;
  time: string;
  status: string;
}

const sampleTrips: SampleTrip[] = [
  { id: "T-1042", passenger: "M. Alvarez", time: "9:15 AM", status: "Assigned" },
  { id: "T-1043", passenger: "D. Chen", time: "9:40 AM", status: "En Route" },
  { id: "T-1044", passenger: "R. Okafor", time: "10:05 AM", status: "Needs Assignment" },
  { id: "T-1045", passenger: "S. Patel", time: "10:30 AM", status: "Completed" },
];

const columns: DataTableColumn<SampleTrip>[] = [
  { key: "id", header: "Trip", primary: true, render: (row) => row.id },
  { key: "passenger", header: "Passenger", render: (row) => row.passenger },
  { key: "time", header: "Pickup time", render: (row) => row.time },
  { key: "status", header: "Status", render: (row) => <TripStatus status={row.status} /> },
];

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className={cn("h-12 w-full rounded-sm border border-border-subtle", className)} />
      <p className={cn(typography.metadata, "text-text-muted")}>{name}</p>
    </div>
  );
}

/**
 * Internal QA harness for the UI foundation — not a product screen. Renders
 * every shared primitive so the design-token wiring can be checked visually
 * in one place. Safe to remove once canonical screens make it redundant.
 */
export default function FoundationPage() {
  const [searchValue, setSearchValue] = useState("");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-zw-2xl px-zw-md py-zw-2xl">
      <PageHeader
        title="UI Foundation"
        description="Internal component showcase for P0-E2-S3 — not a canonical screen."
        breadcrumb={[{ label: "Zenward", href: "/" }, { label: "UI Foundation" }]}
      />

      <Panel>
        <SectionHeader title="Color tokens" description="Nemryn neutrals, action/link/focus/selection, chrome, and semantic status families (N0-M2-A1A)." className="mb-zw-lg" />
        <div className="grid grid-cols-2 gap-zw-md sm:grid-cols-4">
          <Swatch name="Care Navy (Deep Graphite)" className="bg-brand-care-navy" />
          <Swatch name="Action Primary" className="bg-action-primary-background" />
          <Swatch name="Text Link / Focus" className="bg-border-focus" />
          <Swatch name="Selection Wash" className="bg-brand-calm-mist" />
          <Swatch name="Chrome Background" className="bg-chrome-background" />
          <Swatch name="Surface App" className="bg-surface-app" />
          <Swatch name="Surface Hover" className="bg-surface-hover" />
          <Swatch name="Border Strong" className="bg-border-strong" />
        </div>
        <div className="mt-zw-md grid grid-cols-2 gap-zw-md sm:grid-cols-4">
          <Swatch name="Status: Ready" className="bg-success-strong" />
          <Swatch name="Status: Attention" className="bg-warning-strong" />
          <Swatch name="Status: Critical" className="bg-critical-strong" />
          <Swatch name="Status: Information" className="bg-info-strong" />
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Typography" className="mb-zw-lg" />
        <div className="flex flex-col gap-3">
          <p className={typography.display}>Display — marketing hero only</p>
          <p className={typography.pageTitleMarketing}>Page title — marketing</p>
          <p className={typography.pageTitleOperational}>Page title — operational</p>
          <p className={typography.sectionHeading}>Section heading</p>
          <p className={typography.subsectionHeading}>Subsection heading</p>
          <p className={typography.body}>Body copy — the default for most reading content.</p>
          <p className={typography.bodySmall}>Body small — secondary or dense copy.</p>
          <p className={typography.label}>Label</p>
          <p className={typography.metadata}>Metadata / caption</p>
          <p className={typography.numericDisplay}>128</p>
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Buttons" className="mb-zw-lg" />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="text">Text</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <LinkButton href="/operations" variant="outline">
            Link button
          </LinkButton>
          <IconButton label="Location" icon={<MapPin className="size-5" aria-hidden />} variant="outline" />
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Status system" description="Visual presentation only — not a state machine." className="mb-zw-lg" />
        <div className="flex flex-wrap gap-2">
          {STATUS_CATEGORIES.map((category) => (
            <StatusBadge key={category} category={category} label={category} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <TripStatus status="Requested" />
          <TripStatus status="Assigned" />
          <TripStatus status="En Route" />
          <TripStatus status="Completed" />
          <TripStatus status="Cancelled" />
          <DriverStatus status="Available" />
          <DriverStatus status="On Trip" />
          <DriverStatus status="Break" />
          <DriverStatus status="Unavailable" />
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Forms" className="mb-zw-lg" />
        <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
          <Input label="Passenger name" placeholder="Jane Doe" />
          <Input label="Pickup time" required helpText="Use local facility time." />
          <Input label="Phone" error="Enter a valid 10-digit phone number." defaultValue="555-01" />
          <Select
            label="Assistance required"
            placeholder="Select one"
            options={[
              { value: "ambulatory", label: "Ambulatory" },
              { value: "wheelchair", label: "Wheelchair" },
            ]}
          />
          <SearchInput
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            onClear={() => setSearchValue("")}
          />
          <Textarea label="Trip notes" placeholder="Anything the driver should know." />
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Summary strip" className="mb-zw-lg" />
        <SummaryStrip
          items={[
            { label: "Scheduled today", value: 42 },
            { label: "Needs assignment", value: 3, tone: "warning" },
            { label: "Attention required", value: 1, tone: "critical" },
          ]}
        />
      </Panel>

      <Panel>
        <SectionHeader title="Data table" className="mb-zw-lg" />
        <DataTable columns={columns} rows={sampleTrips} getRowId={(row) => row.id} />
      </Panel>

      <Panel>
        <SectionHeader title="Empty & attention states" className="mb-zw-lg" />
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border-subtle">
            <EmptyState
              icon={<Van className="size-8" aria-hidden />}
              title="No trips scheduled"
              description="Trips assigned to this driver will appear here."
            />
          </div>
          <AttentionState
            level="warning"
            title="2 trips need a driver assigned"
            description="Trips within 2 hours of pickup with no assigned driver."
          />
          <AttentionState level="critical" title="Trip T-1044 marked No Show" />
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Definition list & breadcrumb" className="mb-zw-lg" />
        <Breadcrumb items={[{ label: "Trips", href: "/operations/trips" }, { label: "T-1042" }]} />
        <DefinitionList
          className="mt-4"
          columns={2}
          items={[
            { label: "Pickup", value: "123 Main St, Atlanta, GA" },
            { label: "Destination", value: "Grady Memorial Hospital" },
            { label: "Appointment", value: "10:30 AM" },
            { label: "Assistance", value: "Wheelchair" },
          ]}
        />
      </Panel>

      <Panel>
        <SectionHeader title="Avatar" className="mb-zw-lg" />
        <div className="flex items-center gap-3">
          <Avatar name="Sample Dispatcher" size="sm" />
          <Avatar name="Sample Dispatcher" size="md" />
          <Avatar name="Sample Dispatcher" size="lg" />
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Driver mobile foundation" className="mb-zw-lg" />
        <div className="mx-auto flex max-w-sm flex-col gap-3">
          <DriverInstruction instruction="Head to pickup" detail="123 Main St — 6 minutes away" />
          <DriverRoute pickup="123 Main St, Atlanta, GA" destination="Grady Memorial Hospital" />
          <DriverTripCard
            passengerName="M. Alvarez"
            time="9:15 AM"
            pickup="123 Main St"
            destination="Grady Memorial Hospital"
            status="Assigned"
          />
          <DriverTripRow passengerName="D. Chen" time="Yesterday, 2:15 PM" status="Completed" />
          <DriverPrimaryAction>Mark Arrived</DriverPrimaryAction>
        </div>
      </Panel>
    </div>
  );
}

"use client";

import { useActionState, useEffect } from "react";
import {
  createWebsiteIntegrationAction,
  deleteUnusedWebsiteConnectionAction,
  removeUsedWebsiteConnectionAction,
  setWebsiteIntegrationActiveAction,
  updateWebsiteIntegrationOriginAction,
  type WebsiteIntegrationActionState,
} from "@/app/operations/settings/website-requests/actions";
import { CopyValue } from "./CopyValue";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { StatusCategory } from "@/components/ui/StatusBadge";
import type { WebsiteRequestsStatus } from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/** One website connection as the Website Requests screens show it (customer wording; no database ids). */
export interface WebsiteRequestsConnectionView {
  /** Opaque management handle -- posted back to the server actions, never displayed. */
  handle: string;
  /** Needed for the developer package and the collapsed technical details only. */
  integrationId: string;
  website: string | null;
  isActive: boolean;
  status: WebsiteRequestsStatus;
  statusLabel: string;
  statusExplanation: string;
  requestCount: number;
  lastRequestReceived: string | null;
  created: string;
  /** D1 guidance preferences (null = a connection that predates D1). */
  connectionMethod: string | null;
  websiteManager: string | null;
  methodLabel: string;
}

/** One retired connection as "Previous connections" shows it (P1-COMM-D2A; customer wording, no database ids). */
export interface PreviousConnectionView {
  website: string | null;
  connectionMethod: string | null;
  retiredAt: string;
  requestCount: number;
}

const IDLE: WebsiteIntegrationActionState = { status: "idle" };

export const STATUS_CATEGORY: Record<WebsiteRequestsStatus, StatusCategory> = {
  NOT_CONFIGURED: "neutral",
  DISABLED: "neutral",
  READY_TO_TEST: "warning",
  CONNECTED: "positive",
};

/** Lets a long URL wrap at slashes/dots instead of mid-word; `break-words` remains the last-resort fallback so nothing can overflow. */
export function SoftBreak({ text }: { text: string }) {
  const parts = text.split(/(?<=[/.])/);
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && <wbr />}
        </span>
      ))}
    </>
  );
}

export function FormMessage({ state }: { state: WebsiteIntegrationActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}
    >
      {state.message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Connect website
// ---------------------------------------------------------------------------
export function ConnectDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [state, action, pending] = useActionState(createWebsiteIntegrationAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect your website"
      description="Requests sent from this website will appear in your Nemryn Request Hub."
    >
      <form action={action} className="flex flex-col gap-zw-md" noValidate>
        <Input
          label="Website address"
          name="website"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.example.com"
          required
          disabled={pending}
          defaultValue={state.website ?? ""}
          helpText="Use the address visitors see, starting with https:// — no page path."
        />
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending}>
            Connect website
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit website
// ---------------------------------------------------------------------------
export function EditDialog({
  open,
  onClose,
  onDone,
  integration,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  integration: WebsiteRequestsConnectionView;
}) {
  const [state, action, pending] = useActionState(updateWebsiteIntegrationOriginAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog open={open} onClose={onClose} title="Change website" description="Change the website that is approved to send requests to Nemryn.">
      <form action={action} className="flex flex-col gap-zw-md" noValidate>
        <input type="hidden" name="integrationHandle" value={integration.handle} />
        <Input
          label="Website address"
          name="website"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.example.com"
          required
          disabled={pending}
          defaultValue={state.website ?? integration.website ?? ""}
          helpText="Your connection stays the same; only the approved website changes."
        />
        {integration.isActive && (
          <p className={cn(typography.bodySmall, "rounded-sm bg-warning-bg px-3 py-2 text-warning-text")}>
            Website requests are on. Changing the website turns them off until you check the new address and turn them on again.
          </p>
        )}
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending}>
            Save website
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Activate / Disable
// ---------------------------------------------------------------------------
export function ActivateButton({ integration, onDone }: { integration: WebsiteRequestsConnectionView; onDone: (message: string) => void }) {
  const [state, action, pending] = useActionState(setWebsiteIntegrationActiveAction, IDLE);
  useEffect(() => {
    if (state.status === "success") onDone(state.message ?? "");
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="integrationHandle" value={integration.handle} />
      <input type="hidden" name="active" value="true" />
      <Button type="submit" size="sm" loading={pending} disabled={pending}>
        Turn on
      </Button>
      {state.status === "error" && <FormMessage state={state} />}
    </form>
  );
}

export function DisableDialog({
  open,
  onClose,
  onDone,
  integration,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  integration: WebsiteRequestsConnectionView;
}) {
  const [state, action, pending] = useActionState(setWebsiteIntegrationActiveAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Turn off website requests?"
      description="New requests from your website will stop being accepted. Requests you already received stay in your Request Hub."
    >
      <form action={action} className="flex flex-col gap-zw-md">
        <input type="hidden" name="integrationHandle" value={integration.handle} />
        <input type="hidden" name="active" value="false" />
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Keep it on
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending}>
            Turn off
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete (unused) / Remove (used) -- two DIFFERENT, never-interchangeable destructive actions (P1-COMM-D2A).
// Only one is ever offered for a given connection: Delete when it has received zero requests, Remove once it has.
// ---------------------------------------------------------------------------
export function DeleteConnectionDialog({
  open,
  onClose,
  onDone,
  integration,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  integration: WebsiteRequestsConnectionView;
}) {
  const [state, action, pending] = useActionState(deleteUnusedWebsiteConnectionAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete this website connection?"
      description="This connection has not received any transportation requests. Deleting it removes its setup so you can start again with a new connection."
    >
      <form action={action} className="flex flex-col gap-zw-md">
        <input type="hidden" name="integrationHandle" value={integration.handle} />
        <p className={cn(typography.bodySmall, "text-text-secondary")}>This can&apos;t be undone. A new connection will receive a new connection ID.</p>
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending}>
            Delete connection
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RemoveConnectionDialog({
  open,
  onClose,
  onDone,
  integration,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  integration: WebsiteRequestsConnectionView;
}) {
  const [state, action, pending] = useActionState(removeUsedWebsiteConnectionAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Remove this website connection?"
      description="New requests from this connection will stop. Previous requests and their history will remain available in Nemryn."
    >
      <form action={action} className="flex flex-col gap-zw-md">
        <input type="hidden" name="integrationHandle" value={integration.handle} />
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending}>
            Remove connection
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A value row: label, value (wraps, never overflows), optional Copy
// ---------------------------------------------------------------------------
export function ValueRow({ label, children, copy }: { label: string; children: React.ReactNode; copy?: { value: string } }) {
  return (
    <div className="min-w-0">
      <dt className={cn(typography.label, "text-text-muted")}>{label}</dt>
      <dd className="mt-0.5 flex min-w-0 items-start justify-between gap-2">
        <span className={cn(typography.body, "min-w-0 break-words text-text-primary")}>{children}</span>
        {copy && (
          <span className="shrink-0">
            <CopyValue value={copy.value} label={label} />
          </span>
        )}
      </dd>
    </div>
  );
}


import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/auth/profile";
import type { OrganizationContext } from "@/lib/auth/types";
import {
  classifySelfDriverError,
  deriveDriverAccess,
  normalizeSelfDriverInput,
  operationsAccessLabel,
  SELF_DRIVER_FAILURE_MESSAGE,
  SELF_DRIVER_INPUT_MESSAGE,
  type DriverAccessState,
} from "./self-driver-core";

export interface MyAccessSummary {
  name: string;
  email: string | null;
  organizationName: string;
  operationsAccess: string;
  driverAccess: DriverAccessState;
  /** Prefill for the setup form: the existing Driver's name if one exists, else the account's display name. */
  suggestedName: string;
  suggestedPhone: string;
}

/**
 * Settings -> My Access read model. Everything is derived from the session and
 * the RESOLVED organization context -- the browser supplies nothing. The Driver
 * rows read here are the caller's own (`user_id = auth user`) in the current
 * organization only, through the existing Organization Admin SELECT policy on
 * `drivers`; no id of any kind is returned to the page.
 */
export async function getMyAccessSummary(organization: OrganizationContext): Promise<MyAccessSummary> {
  const user = await getUser();
  const supabase = await createServerSupabaseClient();

  const [name, driverRows] = await Promise.all([
    user ? getDisplayName(user.id, user.email ?? null) : Promise.resolve("Unknown User"),
    user
      ? supabase
          .from("drivers")
          .select("display_name, phone, status")
          .eq("organization_id", organization.organizationId)
          .eq("user_id", user.id)
          .order("created_at", { ascending: true })
          .limit(10)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);

  const driverAccess = deriveDriverAccess(driverRows);
  const known = driverRows.find((row) => row.status === "active") ?? driverRows[0];

  return {
    name,
    email: user?.email ?? null,
    organizationName: organization.organizationName,
    operationsAccess: operationsAccessLabel(organization.role),
    driverAccess,
    suggestedName: known?.display_name ?? name,
    suggestedPhone: known?.phone ?? "",
  };
}

export type SelfDriverResult = { ok: true } | { ok: false; message: string };

/**
 * THE one server-side entry point for "link my own account as a Driver". Used by
 * both first-run onboarding and Settings -> My Access, and both call the same
 * database primitive (`link_self_as_driver`). `organization` MUST be the
 * server-resolved context (never a browser-supplied id); the database still
 * re-verifies Organization Admin / active Membership / active organization.
 */
export async function enableSelfDriverAccess(
  organization: OrganizationContext,
  nameRaw: unknown,
  phoneRaw: unknown,
): Promise<SelfDriverResult> {
  const input = normalizeSelfDriverInput(nameRaw, phoneRaw);
  if (!input.ok) return { ok: false, message: SELF_DRIVER_INPUT_MESSAGE[input.error] };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("link_self_as_driver", {
    p_organization_id: organization.organizationId,
    p_display_name: input.displayName,
    p_phone: input.phone ?? undefined,
  });

  if (error) {
    const failure = classifySelfDriverError(error.code);
    if (failure === "failed") console.error(`[self-driver] link_self_as_driver failed (${error.code ?? "no code"})`);
    return { ok: false, message: SELF_DRIVER_FAILURE_MESSAGE[failure] };
  }
  return { ok: true };
}

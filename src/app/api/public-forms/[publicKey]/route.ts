import { NextResponse, type NextRequest } from "next/server";
import { getPublicRequestForm } from "@/lib/public-forms/public-form";
import { isPublicFormKey } from "@/lib/public-forms/public-form-core";

/**
 * P1-COMM-D2 -- the PUBLIC configuration of a published Nemryn form. Passenger-facing fields only (organization display name,
 * copy, service choices, recurring / service-choice flags, published version). Never an organization / form / integration id,
 * Membership, audit or Settings data. An unknown, malformed, unpublished, disabled or suspended-organization key returns the
 * IDENTICAL neutral 404 (no tenant enumeration). No CORS: the Nemryn-hosted pages read this same-origin; nothing on a tenant
 * website needs to.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(_request: NextRequest, context: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = await context.params;
  const form = isPublicFormKey(publicKey) ? await getPublicRequestForm(publicKey) : null;
  if (!form) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(
    {
      ok: true,
      form: {
        organizationName: form.organizationName,
        title: form.title,
        introText: form.introText,
        submitLabel: form.submitLabel,
        confirmationMessage: form.confirmationMessage,
        services: form.services,
        allowRecurring: form.allowRecurring,
        requireServiceChoice: form.requireServiceChoice,
        formVersion: form.formVersion,
      },
    },
    { status: 200, headers: NO_STORE },
  );
}

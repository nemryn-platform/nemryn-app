import { NextResponse, type NextRequest } from "next/server";
import { getPublicInquiryForm } from "@/lib/plus-inquiry/inquiry-public";
import { serviceOptionsFor } from "@/lib/plus-inquiry/inquiry-core";

/**
 * NP-P2-S7-B -- the PUBLIC configuration of an available Nemryn Plus inquiry form: organization display name, headline, intro,
 * offered services, config version and consent text version. Never an organization / form id, allowlist state or settings.
 * Switched off (PLUS_INQUIRY_SUBMISSIONS != "on"), unknown, malformed, draft, disabled, not-allowlisted, suspended or non-write
 * keys all return the IDENTICAL neutral 404 (no tenant enumeration). No CORS: only Nemryn-hosted pages read this.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(_request: NextRequest, context: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = await context.params;
  const form = await getPublicInquiryForm(publicKey);
  if (!form) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(
    {
      ok: true,
      form: {
        organizationName: form.organizationName,
        headline: form.headline,
        introText: form.introText,
        services: serviceOptionsFor(form.services),
        configVersion: form.configVersion,
        consentTextVersion: form.consentTextVersion,
      },
    },
    { status: 200, headers: NO_STORE },
  );
}

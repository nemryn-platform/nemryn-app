import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicInquiryForm } from "@/lib/plus-inquiry/inquiry-public";
import { serviceOptionsFor } from "@/lib/plus-inquiry/inquiry-core";
import { PublicInquiryForm } from "@/components/plus-inquiry/PublicInquiryForm";

/**
 * NP-P2-S7-B -- the page the inquiry embed loader puts in an isolated iframe on an agency website. Same form and the same
 * server-side gates (kill switch + allowlist + publication) as the hosted page; no page chrome; auto-resizing over a validated
 * postMessage protocol. Frame-embedding is allowed for this route ONLY (next.config.ts).
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ask a question", robots: { index: false, follow: false } };

export default async function EmbeddedInquiryPage({ params }: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = await params;
  const form = await getPublicInquiryForm(publicKey);
  if (!form) notFound();
  return (
    <PublicInquiryForm
      publicKey={publicKey}
      mode="embed"
      form={{ organizationName: form.organizationName, headline: form.headline, introText: form.introText, services: serviceOptionsFor(form.services), configVersion: form.configVersion }}
    />
  );
}

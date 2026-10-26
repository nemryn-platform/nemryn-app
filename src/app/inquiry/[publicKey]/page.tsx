import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicInquiryForm } from "@/lib/plus-inquiry/inquiry-public";
import { serviceOptionsFor } from "@/lib/plus-inquiry/inquiry-core";
import { PublicInquiryForm } from "@/components/plus-inquiry/PublicInquiryForm";

/**
 * NP-P2-S7-B -- the Nemryn-HOSTED Plus inquiry form. Public, no account. Available only when the global kill switch is ON and the
 * organization is allowlisted with a published form (both checked on the server). Every other case renders the IDENTICAL neutral
 * not-found page. Not indexed; never framed (next.config.ts).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicKey: string }> }): Promise<Metadata> {
  const { publicKey } = await params;
  const form = await getPublicInquiryForm(publicKey);
  return { title: form ? `${form.headline} | ${form.organizationName}` : "Ask a question", robots: { index: false, follow: false } };
}

export default async function HostedInquiryPage({ params }: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = await params;
  const form = await getPublicInquiryForm(publicKey);
  if (!form) notFound();
  return (
    <main className="min-h-screen bg-neutral-100">
      <PublicInquiryForm
        publicKey={publicKey}
        mode="hosted"
        form={{ organizationName: form.organizationName, headline: form.headline, introText: form.introText, services: serviceOptionsFor(form.services), configVersion: form.configVersion }}
      />
    </main>
  );
}

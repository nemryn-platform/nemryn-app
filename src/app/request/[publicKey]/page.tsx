import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicRequestForm } from "@/lib/public-forms/public-form";
import { PublicRequestForm } from "@/components/public-form/PublicRequestForm";

/**
 * P1-COMM-D2 -- the Nemryn-HOSTED passenger request form. Public: no authentication, no Nemryn account. An unknown, malformed,
 * unpublished, disabled or suspended-organization key renders the IDENTICAL neutral not-found page (no tenant enumeration).
 * Not indexed (MVP: the hosted URL is shared by the operator, not a search landing page) and never framed.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicKey: string }> }): Promise<Metadata> {
  const { publicKey } = await params;
  const form = await getPublicRequestForm(publicKey);
  return { title: form ? `${form.title} | ${form.organizationName}` : "Request transportation", robots: { index: false, follow: false } };
}

export default async function HostedRequestPage({ params }: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = await params;
  const form = await getPublicRequestForm(publicKey);
  if (!form) notFound();
  return (
    <main className="min-h-screen bg-neutral-100 sm:py-2">
      <PublicRequestForm publicKey={publicKey} config={form} mode="hosted" />
    </main>
  );
}

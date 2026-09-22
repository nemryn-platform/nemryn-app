import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicRequestForm } from "@/lib/public-forms/public-form";
import { PublicRequestForm } from "@/components/public-form/PublicRequestForm";

/**
 * P1-COMM-D2 -- the page the Nemryn embed loader puts in an isolated iframe on a tenant's website. Same public form, no page
 * chrome, auto-resizing, talking to the loader over a validated postMessage protocol. Frame-embedding is allowed for this route
 * ONLY (see next.config.ts); the hosted route and the rest of the app are not affected.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Request transportation", robots: { index: false, follow: false } };

export default async function EmbeddedRequestPage({ params }: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = await params;
  const form = await getPublicRequestForm(publicKey);
  if (!form) notFound();
  return <PublicRequestForm publicKey={publicKey} config={form} mode="embed" />;
}

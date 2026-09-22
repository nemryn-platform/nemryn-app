import { UnavailableForm } from "@/components/public-form/UnavailableForm";

/** Embedded twin of the neutral unavailable state: compact, and it auto-sizes the iframe like the form does. */
export default function EmbeddedRequestFormUnavailable() {
  return <UnavailableForm embed />;
}

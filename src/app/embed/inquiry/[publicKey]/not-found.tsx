import { InquiryUnavailable } from "@/components/plus-inquiry/InquiryUnavailable";

/** Embedded twin of the neutral unavailable state: compact, and it auto-sizes the iframe like the form does. */
export default function EmbeddedInquiryUnavailable() {
  return <InquiryUnavailable embed />;
}

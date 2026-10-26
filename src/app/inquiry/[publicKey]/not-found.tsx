import { InquiryUnavailable } from "@/components/plus-inquiry/InquiryUnavailable";

/** The one neutral "unavailable" page for every kind of unavailable inquiry form. Says nothing about why. */
export default function InquiryFormUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
      <InquiryUnavailable embed={false} />
    </main>
  );
}

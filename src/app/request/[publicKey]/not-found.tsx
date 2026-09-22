import { UnavailableForm } from "@/components/public-form/UnavailableForm";

/** The one neutral "unavailable" page for every kind of unavailable public form. Says nothing about why. */
export default function RequestFormUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
      <UnavailableForm embed={false} />
    </main>
  );
}

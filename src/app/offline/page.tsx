import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const dynamic = "force-static";
export const metadata = { title: "Offline", robots: { index: false, follow: false } };

/**
 * The Driver offline page (P1-PILOT-S5A). Public, static and tenant-free: it is
 * precached by the service worker and shown when a /driver navigation cannot reach
 * Nemryn. It deliberately contains NO operational data and makes NO promise that
 * updates will sync later -- there is no offline queue; the server is authoritative.
 * No client JavaScript is required (a plain link), so it renders fully offline.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/nemryn-symbol-primary.svg" alt="" width={48} height={48} className="size-12" />
      <h1 className={cn(typography.sectionHeading, "text-text-primary")}>You&apos;re offline</h1>
      <p className={cn(typography.body, "text-text-secondary")}>Reconnect to view current trip information.</p>
      <ul className={cn(typography.bodySmall, "flex flex-col gap-1 text-text-secondary")}>
        <li>Your connection is unavailable, so current trip details may not be shown.</li>
        <li>Trip updates cannot be sent until your connection returns.</li>
      </ul>
      <a
        href="/driver"
        className={cn(typography.button, "mt-2 inline-flex h-12 items-center justify-center rounded-md bg-action-primary-background px-6 text-action-primary-foreground")}
      >
        Try again
      </a>
    </main>
  );
}

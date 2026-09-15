import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Nemryn typography foundation (N0-M2-A1A, LOCKED brand-lock-v1.md §10):
 * Geist Sans replaces Manrope+Inter as the single application/marketing
 * family — no separate display face. Loaded via `next/font/google`
 * (bundled in this Next.js version, confirmed directly — no new
 * dependency), matching the exact loading mechanism Manrope/Inter already
 * used here, so the swap carries no new build/runtime machinery. Weights
 * 400/500/600 cover the full application range (13-typography-
 * specification.md §4 — "700 is not used in the application"); Geist
 * Mono is loaded selectively for the small set of operational-data roles
 * that will consume it in a later module-migration phase (§6 there) —
 * loading it now costs nothing extra since it's only fetched where
 * actually referenced by a rendered `font.mono` class.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Nemryn",
    template: "%s | Nemryn",
  },
  description: "Operating infrastructure for medical transportation.",
  /**
   * N0-M2-A3: nemryn-favicon.svg (N0-M2-A2's original choice) is a
   * transparent Deep Graphite symbol with no background of its own —
   * effectively invisible against a dark browser tab bar, confirmed by
   * direct human observation. nemryn-app-icon.svg carries its own
   * Deep Graphite rounded-square tile behind a Mineral White symbol, so
   * it stays legible regardless of the browser's own chrome color.
   * Still the Next.js Metadata API `icons` field — no copy, no
   * conversion, no PWA manifest. src/app/favicon.ico remains removed
   * (N0-M2-A2) so it cannot reintroduce a competing icon link.
   */
  icons: {
    icon: "/brand/nemryn-app-icon.svg",
  },
};

/**
 * `viewportFit: "cover"` lets the Driver shell's fixed header/bottom-nav
 * read `env(safe-area-inset-*)` on notched devices (P1-E3-S2, work item
 * §44). Harmless on Operations/desktop — it only changes behavior on
 * devices that report a safe-area inset at all.
 */
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full font-sans text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}

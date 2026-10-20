import Link from "next/link";
import { PublicStateFrame } from "@/components/ui/RouteState";
import { LinkButton } from "@/components/ui/LinkButton";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export const metadata = { title: "Page not found", robots: { index: false, follow: false } };

/**
 * Branded 404 for routes outside the Operations shell (NP-UI-P1a): unknown URLs, and notFound() from public / print
 * routes such as /quote-print. Nemryn-only identity (Brand Lock §12). The same safe 404 for unknown, foreign and
 * inaccessible records -- it never says which one it was.
 */
export default function NotFound() {
  return (
    <PublicStateFrame
      title="Page not found"
      testId="not-found"
      actions={
        <>
          <LinkButton href="/" className="w-full justify-center">
            Go to Nemryn
          </LinkButton>
          <Link href="/sign-in" className={cn(typography.bodySmall, "text-center text-text-link underline underline-offset-2")}>
            Sign in
          </Link>
        </>
      }
    >
      <p>This page could not be found. (404)</p>
      <p className="mt-2">The link may be out of date, or you may not have access to it.</p>
    </PublicStateFrame>
  );
}

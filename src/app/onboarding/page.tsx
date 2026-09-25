import { redirect } from "next/navigation";

/**
 * Legacy /onboarding entry (P1-OPS-PROG3B). The size question that used to
 * live here was retired; guided setup now starts at Business basics. Kept
 * as a server redirect so bookmarks and older links still work.
 */
export default function OnboardingIndexPage() {
  redirect("/onboarding/basics");
}

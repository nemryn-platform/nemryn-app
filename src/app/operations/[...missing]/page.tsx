import { notFound } from "next/navigation";

/**
 * NP-UI-P1a (C2): any unknown /operations/* URL renders the branded not-found INSIDE the Operations shell instead of
 * the bare root 404. Explicit routes always take precedence over this catch-all; the operations layout still runs its
 * own authorization first (signed-out visitors are redirected before this renders).
 */
export default function MissingOperationsPage() {
  notFound();
}

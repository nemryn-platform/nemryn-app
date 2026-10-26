/**
 * Growth navigation rules (NP-P2-S2, Phase B). Runtime-import-free (unit-tested under plain Node:
 * growth-nav-core.test.mjs). Used by the Growth group of the existing Operations sidebar (GrowthNavGroup).
 */

export const GROWTH_ROOT = "/operations/growth";

export type GrowthChildKey = "growth" | "inquiries" | "pipeline" | "contacts" | "quotes" | "tasks";

/** The Growth group's children, in canonical order (product spec 7.1). Tasks joined in NP-P2-S2; Estimates & Quotes in NP-P2-S5-S3A; Inquiries in NP-P2-S7-C. */
export const GROWTH_CHILDREN: readonly { key: GrowthChildKey; label: string; href: string }[] = [
  { key: "growth", label: "Dashboard", href: GROWTH_ROOT },
  { key: "inquiries", label: "Inquiries", href: `${GROWTH_ROOT}/inquiries` },
  { key: "pipeline", label: "Pipeline", href: `${GROWTH_ROOT}/pipeline` },
  { key: "contacts", label: "Contacts", href: `${GROWTH_ROOT}/contacts` },
  { key: "quotes", label: "Estimates & Quotes", href: `${GROWTH_ROOT}/quotes` },
  { key: "tasks", label: "Tasks", href: `${GROWTH_ROOT}/tasks` },
];

export function isGrowthRoute(pathname: string): boolean {
  return pathname === GROWTH_ROOT || pathname.startsWith(`${GROWTH_ROOT}/`);
}

/** Dashboard matches itself and the Growth Agent page it hosts; every other child matches its own sub-tree. */
export function isGrowthChildActive(href: string, pathname: string): boolean {
  if (href === GROWTH_ROOT) return pathname === GROWTH_ROOT || pathname === `${GROWTH_ROOT}/agent` || pathname.startsWith(`${GROWTH_ROOT}/agent/`);
  return pathname === href || pathname.startsWith(`${href}/`);
}

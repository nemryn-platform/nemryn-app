/**
 * Pure helpers behind the shared UI primitives (NP-UI-P1a). Runtime-import-free so they can be unit-tested under plain
 * Node (ui-core.test.mjs). Keyboard behaviour follows the WAI-ARIA Authoring Practices patterns for tabs, radio groups
 * and menus.
 */

export type Orientation = "horizontal" | "vertical";

/**
 * The index a roving-focus composite (tabs, radio group, menu) moves to for a key press, skipping disabled items.
 * Returns null when the key is not a navigation key for this orientation (the caller lets it through). Wraps around.
 */
export function nextIndex(key: string, current: number, disabled: readonly boolean[], orientation: Orientation = "horizontal"): number | null {
  const count = disabled.length;
  if (count === 0 || disabled.every(Boolean)) return null;
  const forward = orientation === "horizontal" ? ["ArrowRight"] : ["ArrowDown"];
  const backward = orientation === "horizontal" ? ["ArrowLeft"] : ["ArrowUp"];
  const step = (from: number, dir: 1 | -1) => {
    let i = from;
    for (let n = 0; n < count; n++) {
      i = (i + dir + count) % count;
      if (!disabled[i]) return i;
    }
    return from;
  };
  if (forward.includes(key)) return step(current, 1);
  if (backward.includes(key)) return step(current, -1);
  if (key === "Home") return step(count - 1, 1);
  if (key === "End") return step(0, -1);
  return null;
}

/** The first enabled index at or after `from` (or -1), used for the initial roving tab stop. */
export function firstEnabled(disabled: readonly boolean[], from = 0): number {
  for (let i = from; i < disabled.length; i++) if (!disabled[i]) return i;
  for (let i = 0; i < from && i < disabled.length; i++) if (!disabled[i]) return i;
  return -1;
}

/**
 * Compact page list for a pager: always the first and last page, the current page with `siblings` either side, and
 * "gap" markers where pages are skipped. Pages are 1-based. Example: (6, 12) -> [1, "gap", 5, 6, 7, "gap", 12].
 */
export function paginationRange(page: number, totalPages: number, siblings = 1): (number | "gap")[] {
  const total = Math.max(0, Math.floor(totalPages));
  if (total === 0) return [];
  const current = Math.min(Math.max(1, Math.floor(page)), total);
  const start = Math.max(2, current - siblings);
  const end = Math.min(total - 1, current + siblings);
  const out: (number | "gap")[] = [1];
  if (start > 2) out.push(start === 3 ? 2 : "gap");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push(end === total - 2 ? total - 1 : "gap");
  if (total > 1) out.push(total);
  return out;
}

/** "Showing 26–50 of 112" style range for a page; zero items -> null. */
export function pageItemRange(page: number, pageSize: number, totalItems: number): { from: number; to: number } | null {
  if (totalItems <= 0 || pageSize <= 0) return null;
  const totalPages = Math.ceil(totalItems / pageSize);
  const current = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const from = (current - 1) * pageSize + 1;
  return { from, to: Math.min(totalItems, current * pageSize) };
}

/** Typeahead for menus: the next enabled item (after `current`) whose label starts with the typed character. */
export function typeaheadIndex(char: string, current: number, labels: readonly string[], disabled: readonly boolean[]): number | null {
  const c = char.trim().toLowerCase();
  if (c.length !== 1) return null;
  const n = labels.length;
  for (let k = 1; k <= n; k++) {
    const i = (current + k) % n;
    if (!disabled[i] && labels[i].trim().toLowerCase().startsWith(c)) return i;
  }
  return null;
}

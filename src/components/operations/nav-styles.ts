/**
 * The Operations sidebar's nav item treatment, shared by OperationsSidebar and GrowthNavGroup. Brand Lock v2 (§4,
 * Concept B `.nav-link`): 39px items, 9px radius (`rounded-sm`), 13px labels. Active = the slate active gradient, a
 * 3px teal marker and a faint inner edge (one inset box-shadow, no double stroke), white 600 text. The marker is a
 * brand accent, not a "ready" status. Text and hover use the chrome.* tokens only.
 */
export const navItemBase =
  "relative flex min-h-[2.4375rem] items-center gap-3 rounded-sm px-3 py-2 font-medium transition-colors duration-base motion-reduce:transition-none";
export const navItemActive =
  "bg-chrome-item-active-background bg-chrome-active font-semibold text-chrome-item-active-text shadow-[inset_3px_0_0_var(--color-chrome-item-active-marker),inset_0_0_0_1px_rgba(255,255,255,0.09)]";
export const navItemIdle = "text-chrome-text-secondary hover:bg-chrome-item-hover hover:text-chrome-text-primary";

/**
 * NP-UI-P1b: the Operations sidebar's nav item treatment, shared by OperationsSidebar and GrowthNavGroup. Active = the
 * steel chrome wash plus a slim left marker (`chrome.item.active.marker`: informational, never a "ready" green and
 * never the mockup's teal), no double stroke. Text and hover use the chrome.* tokens only.
 */
export const navItemBase =
  "relative flex items-center gap-3 rounded-sm px-3 py-2 font-medium transition-colors duration-base motion-reduce:transition-none";
export const navItemActive =
  "bg-chrome-item-active-background text-chrome-item-active-text before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-chrome-item-active-marker";
export const navItemIdle = "text-chrome-text-secondary hover:bg-chrome-item-hover hover:text-chrome-text-primary";

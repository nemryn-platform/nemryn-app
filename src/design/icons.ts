import {
  SquaresFour,
  Tray,
  Path,
  NavigationArrow,
  Users,
  Buildings,
  IdentificationCard,
  Van,
  Receipt,
  ChartBar,
  Gear,
  MapPin,
  SteeringWheel,
  UsersThree,
  ListChecks,
  PlugsConnected,
  Bell,
  Clock,
  ShieldCheck,
  ClockCounterClockwise,
  UserCircle,
  CalendarCheck,
  Repeat,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

/**
 * Centralized operations sidebar icon mapping. See /docs/design/design-tokens.md
 * and ZD-031 (Phosphor Icons, Regular/Medium weight). Do not import icons
 * ad hoc in page/component code — add them here so the mapping stays the
 * single source of truth for nav iconography.
 *
 * Note: "Trips" was specified as Route in the reference mapping. Phosphor
 * has no icon literally named `Route` — `Path` is the closest official
 * equivalent (a traced line/route glyph) per the "choose the closest
 * official Phosphor equivalent" instruction. Flagged for design review.
 */
export const navIcons: Record<string, Icon> = {
  overview: SquaresFour,
  requests: Tray,
  trips: Path,
  dispatch: NavigationArrow,
  tomorrow: CalendarCheck,
  recurring: Repeat,
  passengers: Users,
  facilities: Buildings,
  drivers: IdentificationCard,
  fleet: Van,
  billing: Receipt,
  reports: ChartBar,
  settings: Gear,
  location: MapPin,
  drive: SteeringWheel,
};

export type NavIconKey = keyof typeof navIcons;

/**
 * Settings section iconography (P1-PILOT-S4B-R4A) -- one entry per section
 * of the tenant Settings information architecture, keyed by the same slug
 * the section's route uses (/operations/settings/<slug>).
 */
export const settingsIcons: Record<string, Icon> = {
  organization: Buildings,
  "my-access": UserCircle,
  team: UsersThree,
  services: ListChecks,
  "website-requests": PlugsConnected,
  notifications: Bell,
  operations: Clock,
  security: ShieldCheck,
  activity: ClockCounterClockwise,
};

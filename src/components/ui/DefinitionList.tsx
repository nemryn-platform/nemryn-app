import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface DefinitionItem {
  label: string;
  value: React.ReactNode;
  /** NP-UI-V2-2: spans every column of a 2-column list (a long value such as an email address). */
  fullWidth?: boolean;
}

export interface DefinitionListProps {
  items: DefinitionItem[];
  columns?: 1 | 2;
  className?: string;
}

/** Label/value detail pairs — e.g. trip detail metadata. Semantic dl/dt/dd. */
export function DefinitionList({ items, columns = 1, className }: DefinitionListProps) {
  return (
    <dl className={cn("grid gap-x-zw-lg gap-y-zw-md", columns === 2 ? "grid-cols-2" : "grid-cols-1", className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.fullWidth && "col-span-full")}>
          <dt className={cn(typography.label, "text-text-muted")}>{item.label}</dt>
          <dd className={cn(typography.body, "mt-0.5 break-words text-text-primary")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

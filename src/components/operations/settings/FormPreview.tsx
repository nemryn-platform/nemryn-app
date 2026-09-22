"use client";

import { useState } from "react";
import type { FormPreview as FormPreviewModel, PreviewField } from "@/lib/operations/website-requests-core";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const CONTROL = "w-full rounded-sm border border-border-subtle bg-surface-primary px-3 py-2 text-text-primary";

function PreviewControl({ field, id, onToggle }: { field: PreviewField; id: string; onToggle?: (checked: boolean) => void }) {
  // Inert on purpose: nothing typed here is kept, and nothing on this preview can be sent anywhere.
  switch (field.kind) {
    case "textarea":
      return <textarea id={id} rows={2} disabled className={CONTROL} />;
    case "select":
      return (
        <select id={id} disabled className={CONTROL} defaultValue="">
          <option value="">Choose…</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "radio":
      return (
        <div className="flex flex-wrap gap-4" role="radiogroup" aria-labelledby={`${id}-label`}>
          {field.options?.map((o) => (
            <label key={o.value} className={cn(typography.bodySmall, "flex items-center gap-1.5 text-text-primary")}>
              <input type="radio" disabled /> {o.label}
            </label>
          ))}
        </div>
      );
    case "weekdays":
      return (
        <div className="flex flex-wrap gap-3" role="group" aria-labelledby={`${id}-label`}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <label key={d} className={cn(typography.bodySmall, "flex items-center gap-1.5 text-text-primary")}>
              <input type="checkbox" disabled /> {d}
            </label>
          ))}
        </div>
      );
    case "checkbox":
      // The recurring checkbox is the ONE live control: it only reveals the disabled recurring fields (local state, nothing is sent).
      return onToggle ? <input id={id} type="checkbox" onChange={(e) => onToggle(e.target.checked)} /> : <input id={id} type="checkbox" disabled />;
    default:
      return <input id={id} type={field.kind} disabled className={CONTROL} />;
  }
}

/**
 * Safe preview of the Nemryn form: pure presentation of the saved-or-draft configuration. It has no <form>, no network
 * call and no real Submit; "Preview confirmation" only swaps local text so the operator can read the confirmation message.
 */
export function FormPreview({ preview }: { preview: FormPreviewModel }) {
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [recurringOn, setRecurringOn] = useState(false);
  return (
    <div data-testid="form-preview" className="flex flex-col gap-zw-md rounded-md border border-dashed border-border-strong bg-surface-elevated p-zw-md">
      <p className={cn(typography.label, "self-start rounded-sm bg-surface-secondary px-2 py-0.5 text-text-secondary")}>
        Preview only — nothing here is sent to Nemryn
      </p>
      {showConfirmation ? (
        <div role="status" className="flex flex-col gap-2 rounded-sm border border-border-subtle p-zw-md">
          <p className={cn(typography.subsectionHeading, "text-text-primary")}>Request received</p>
          <p className={cn(typography.body, "text-text-secondary")}>{preview.confirmationMessage}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowConfirmation(false)}>
            Back to the form
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className={cn(typography.metadata, "text-text-muted")}>{preview.organizationName}</p>
            <h3 className={cn(typography.sectionHeading, "text-text-primary")}>{preview.title}</h3>
            {preview.intro && <p className={cn(typography.body, "text-text-secondary")}>{preview.intro}</p>}
          </div>
          <p className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary p-2 text-text-primary")}>{preview.safetyNote}</p>
          {preview.sections.map((section, s) => (
            <div key={section.heading} className="flex flex-col gap-zw-sm">
              <h4 className={cn(typography.label, "text-text-primary")}>{section.heading}</h4>
              {section.fields.filter((field) => field.showWhen !== "recurring" || recurringOn).map((field) => {
                const id = `preview-${s}-${field.key}`;
                return (
                  <div key={field.key} className="flex flex-col gap-1">
                    <label id={`${id}-label`} htmlFor={id} className={cn(typography.bodySmall, "text-text-primary")}>
                      {field.label}
                      {field.required ? <span aria-hidden> *</span> : <span className="text-text-muted"> (optional)</span>}
                    </label>
                    <PreviewControl field={field} id={id} onToggle={field.key === "recurring" ? setRecurringOn : undefined} />
                    {field.help && <span className={cn(typography.metadata, "text-text-muted")}>{field.help}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          <p className={cn(typography.metadata, "text-text-muted")}>{preview.privacyNote}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="md" variant="primary" disabled aria-disabled>
              {preview.submitLabel}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowConfirmation(true)}>
              Preview confirmation message
            </Button>
          </div>
        </>
      )}
      <p className={cn(typography.metadata, "text-text-muted")}>Form version {preview.formVersion}</p>
    </div>
  );
}

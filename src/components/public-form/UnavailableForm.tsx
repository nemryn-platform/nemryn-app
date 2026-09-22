"use client";

import { useRef } from "react";
import { useParams } from "next/navigation";
import { PUBLIC_FORM_COPY, isPublicFormKey } from "@/lib/public-forms/public-form-core";
import { useEmbedParent } from "./useEmbedParent";

/** The one neutral "unavailable" state (unknown / malformed / unpublished / disabled / suspended -- indistinguishable). */
export function UnavailableForm({ embed }: { embed: boolean }) {
  const params = useParams<{ publicKey?: string }>();
  const key = isPublicFormKey(params?.publicKey) ? params.publicKey : "";
  const rootRef = useRef<HTMLDivElement>(null);
  useEmbedParent({ enabled: embed && key !== "", publicKey: key, rootRef });
  return (
    <div ref={rootRef} role="alert" className={embed ? "bg-white p-4 text-neutral-900" : "max-w-md rounded-lg border border-neutral-300 bg-white p-8 text-neutral-900"}>
      <h1 className="text-xl font-semibold">{PUBLIC_FORM_COPY.unavailableTitle}</h1>
      <p className="mt-2 text-base text-neutral-700">{PUBLIC_FORM_COPY.unavailableBody}</p>
    </div>
  );
}

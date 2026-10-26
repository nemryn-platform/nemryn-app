"use client";

import { useRef } from "react";
import { useParams } from "next/navigation";
import { INQUIRY_COPY, isInquiryKey } from "@/lib/plus-inquiry/inquiry-core";
import { useInquiryEmbedParent } from "./useInquiryEmbedParent";

/**
 * The one neutral "unavailable" state of the inquiry form (NP-P2-S7-B): switched off, unknown, malformed, draft, disabled,
 * not allowlisted, suspended or non-write -- indistinguishable, and it says nothing about why.
 */
export function InquiryUnavailable({ embed }: { embed: boolean }) {
  const params = useParams<{ publicKey?: string }>();
  const key = isInquiryKey(params?.publicKey) ? params.publicKey : "";
  const rootRef = useRef<HTMLDivElement>(null);
  useInquiryEmbedParent({ enabled: embed && key !== "", publicKey: key, rootRef });
  return (
    <div ref={rootRef} role="alert" data-testid="public-inquiry-unavailable" className={embed ? "bg-white p-4 text-neutral-900" : "max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm"}>
      <h1 className="text-xl font-semibold">{INQUIRY_COPY.unavailableTitle}</h1>
      <p className="mt-2 text-base text-neutral-700">{INQUIRY_COPY.unavailableBody}</p>
    </div>
  );
}

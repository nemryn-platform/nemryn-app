"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { INQUIRY_EMBED_SOURCE, INQUIRY_EMBED_VERSION, isInquiryEmbedMessage } from "@/lib/plus-inquiry/inquiry-core";
import { clampEmbedHeight, sanitizeAcquisitionContext } from "@/lib/public-forms/public-form-core";

/**
 * The iframe side of the inquiry embed protocol (NP-P2-S7-B; the same rules as the Core request form, its own message source
 * and "inq_" key namespace). Talks ONLY to the window that embeds us and ONLY after that window sent a well-formed `context`
 * message for THIS key:
 *  - inbound: event.source must be window.parent; the payload must match the protocol; the acquisition context is re-sanitised
 *    to the closed S4C set (pure helpers imported from the Core form, not modified);
 *  - outbound: the content-free "ready" hello is the only message addressed to "*"; every later message (resize / submitted)
 *    goes only to the origin that delivered the verified context. No inquiry content is ever posted.
 */
export function useInquiryEmbedParent(options: {
  enabled: boolean;
  publicKey: string;
  rootRef: RefObject<HTMLElement | null>;
  onContext?: (acquisition: Record<string, string> | null) => void;
}) {
  const { enabled, publicKey, rootRef, onContext } = options;
  const parentOrigin = useRef<string | null>(null);
  const onContextRef = useRef(onContext);
  useEffect(() => {
    onContextRef.current = onContext;
  });

  const post = useCallback(
    (type: "resize" | "submitted") => {
      const target = parentOrigin.current;
      if (!enabled || window.parent === window || !target) return;
      const message =
        type === "resize"
          ? { source: INQUIRY_EMBED_SOURCE, v: INQUIRY_EMBED_VERSION, type, key: publicKey, height: clampEmbedHeight(rootRef.current?.getBoundingClientRect().height ?? document.body.scrollHeight) }
          : { source: INQUIRY_EMBED_SOURCE, v: INQUIRY_EMBED_VERSION, type, key: publicKey };
      window.parent.postMessage(message, target);
    },
    [enabled, publicKey, rootRef],
  );

  useEffect(() => {
    if (!enabled || window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isInquiryEmbedMessage(event.data, publicKey, "context")) return;
      parentOrigin.current = event.origin;
      onContextRef.current?.(sanitizeAcquisitionContext((event.data as Record<string, unknown>).acquisition));
      post("resize");
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ source: INQUIRY_EMBED_SOURCE, v: INQUIRY_EMBED_VERSION, type: "ready", key: publicKey }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, publicKey, post]);

  useEffect(() => {
    const el = rootRef.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => post("resize"));
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, rootRef, post]);

  return post;
}

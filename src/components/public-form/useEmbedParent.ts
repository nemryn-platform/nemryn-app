"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  EMBED_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  clampEmbedHeight,
  isEmbedMessage,
  sanitizeAcquisitionContext,
} from "@/lib/public-forms/public-form-core";

/**
 * The iframe side of the embed protocol (P1-COMM-D2). Talks ONLY to the window that embeds us and ONLY after that window has
 * sent a well-formed `context` message for THIS form key:
 *  - inbound: event.source must be window.parent (a sibling frame, popup or unrelated window is ignored), the payload must match
 *    the protocol, and the acquisition context is re-sanitised to the closed S4C set;
 *  - outbound: the first message ("ready") is content-free and is the only one addressed to "*" (the parent origin is not known
 *    yet); every later message (resize / submitted) is addressed to the origin that delivered the verified context, never "*".
 * A plain iframe without the loader simply never receives a context and therefore never posts anything further.
 */
export function useEmbedParent(options: {
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
          ? { source: EMBED_MESSAGE_SOURCE, v: EMBED_MESSAGE_VERSION, type, key: publicKey, height: clampEmbedHeight(rootRef.current?.getBoundingClientRect().height ?? document.body.scrollHeight) }
          : { source: EMBED_MESSAGE_SOURCE, v: EMBED_MESSAGE_VERSION, type, key: publicKey };
      window.parent.postMessage(message, target);
    },
    [enabled, publicKey, rootRef],
  );

  useEffect(() => {
    if (!enabled || window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isEmbedMessage(event.data, publicKey, "context")) return;
      parentOrigin.current = event.origin;
      onContextRef.current?.(sanitizeAcquisitionContext((event.data as Record<string, unknown>).acquisition));
      post("resize");
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ source: EMBED_MESSAGE_SOURCE, v: EMBED_MESSAGE_VERSION, type: "ready", key: publicKey }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, publicKey, post]);

  // Auto-height: report whenever the content height changes (validation errors, recurring fields, confirmation, unavailable).
  useEffect(() => {
    const el = rootRef.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => post("resize"));
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, rootRef, post]);

  return post;
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DeviceMobile, DownloadSimple, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { isIosDevice, isStandaloneDisplay } from "@/lib/pwa/pwa-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallMode = "unknown" | "installed" | "prompt" | "ios" | "manual";

const noopSubscribe = () => () => undefined;
function detectMode(): InstallMode {
  const standalone = isStandaloneDisplay(window.matchMedia("(display-mode: standalone)").matches, (navigator as Navigator & { standalone?: boolean }).standalone);
  if (standalone) return "installed";
  return isIosDevice(navigator.userAgent, navigator.maxTouchPoints) ? "ios" : "manual";
}

/**
 * Restrained "Install the app" entry (P1-PILOT-S5A). Lives ONLY on the Driver
 * Profile screen: it never nags, never appears as a modal, and never gates
 * anything -- the Driver workspace is fully usable in an ordinary browser.
 *  - Chromium/Android: a real Install button once the browser offers `beforeinstallprompt`.
 *  - iOS/iPadOS Safari (no install event exists): a one-line "Share -> Add to Home Screen" hint.
 *  - Already running standalone: a plain confirmation.
 */
export function DriverInstallCard() {
  // Environment facts are read with useSyncExternalStore: "unknown" on the server, real value on the client.
  const detected = useSyncExternalStore<InstallMode>(noopSubscribe, detectMode, () => "unknown");
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installedNow, setInstalledNow] = useState(false);
  const mode: InstallMode = installedNow ? "installed" : deferred && detected !== "installed" ? "prompt" : detected;

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalledNow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "unknown") return null;

  return (
    <Panel className="flex flex-col gap-zw-sm" data-install-mode={mode}>
      <div className="flex items-center gap-2">
        <DeviceMobile className="size-5 text-text-muted" aria-hidden />
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Nemryn Driver app</h2>
      </div>
      {mode === "installed" && <p className={cn(typography.bodySmall, "text-text-secondary")}>You&apos;re using Nemryn Driver as an installed app.</p>}
      {mode === "prompt" && (
        <>
          <p className={cn(typography.bodySmall, "text-text-secondary")}>Add Nemryn Driver to your home screen to open it like an app.</p>
          <Button
            type="button"
            variant="outline"
            leadingIcon={<DownloadSimple className="size-4" aria-hidden />}
            onClick={async () => {
              if (!deferred) return;
              await deferred.prompt();
              await deferred.userChoice.catch(() => undefined);
              setDeferred(null); // the browser allows one prompt per event
            }}
          >
            Install app
          </Button>
        </>
      )}
      {mode === "ios" && (
        <p className={cn(typography.bodySmall, "flex items-start gap-2 text-text-secondary")}>
          <ShareNetwork className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>To install: tap Share, then Add to Home Screen.</span>
        </p>
      )}
      {mode === "manual" && <p className={cn(typography.bodySmall, "text-text-secondary")}>You can also add Nemryn Driver to your home screen from your browser&apos;s menu.</p>}
      <p className={cn(typography.metadata, "text-text-muted")}>Installing is optional. Nemryn Driver works the same in your browser.</p>
    </Panel>
  );
}

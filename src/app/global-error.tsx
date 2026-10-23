"use client";

import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself (NP-UI-P1a, A5). It replaces the whole document, so it
 * renders its own <html lang> / <title> and uses only plain markup and the shared token stylesheet (no shell, no
 * fonts, no data). The canonical Nemryn logo is shown from its approved file. Never shows the error message.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong | Nemryn</title>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body className="bg-surface-app bg-canvas-glow">
        <main className="flex min-h-dvh items-center justify-center px-4 py-12" data-testid="global-error">
          <div className="w-full max-w-sm rounded-lg border border-border-subtle bg-surface-elevated p-8 text-text-primary shadow-panel">
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image is unavailable when the root layout failed */}
            <img src="/brand/nemryn-logo-primary.svg" alt="Nemryn" width={434} height={127} className="mx-auto mb-8 h-auto w-60" />
            <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
            <p className="mb-8 text-sm text-text-secondary">Nemryn couldn&apos;t load this page. Try again in a moment.</p>
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-action-primary-background px-4 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover"
            >
              Try again
            </button>
            {error.digest && <p className="mt-6 text-xs text-text-muted">Reference: {error.digest}</p>}
          </div>
        </main>
      </body>
    </html>
  );
}

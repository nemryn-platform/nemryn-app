#!/usr/bin/env bash
# NP-RELEASE-01 / 01A -- Vercel "Ignored Build Step" command (Project Settings -> Git -> Ignored Build Step):
#   bash scripts/release/vercel-ignore-build.sh
# Vercel semantics: exit 0 = SKIP (ignore) this build; exit 1 OR GREATER = BUILD.
# Because ANY non-zero status builds, this script must never end non-zero by accident:
#   - no `set -e` / `set -u` (an aborted script exits non-zero, which would BUILD);
#   - an EXIT trap forces status 0 on every path except the single explicit BUILD below;
#   - TERM / INT / HUP (e.g. a timeout) also end with 0. (SIGKILL cannot be trapped -- see the 01A report.)
# The build proceeds ONLY when the checker ran to completion (exit 0) AND printed exactly
# "VERCEL_BUILD_DECISION=BUILD". A crash, a missing node binary, BLOCKED or UNVERIFIABLE all SKIP.
# The script locates the repository from its own path, so it works whatever directory Vercel starts it in.
trap 'exit 0' EXIT
trap 'exit 0' TERM INT HUP
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
cd "$here/../.." 2>/dev/null || exit 0
out="$(node scripts/release/check-db-compat.mjs --vercel 2>&1)"
rc=$?
printf '%s\n' "$out"
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -qx 'VERCEL_BUILD_DECISION=BUILD'; then
  echo "release gate: proceeding with the build"
  trap - EXIT
  exit 1
fi
echo "release gate: build SKIPPED (not verified as compatible)"
exit 0

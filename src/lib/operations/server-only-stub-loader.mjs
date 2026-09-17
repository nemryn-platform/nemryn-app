// Node ESM loader hook used ONLY to unit-test server-only-marked
// modules (day-bounds.ts, local-time.ts) directly under plain Node,
// without a Next.js bundler in front of them. It does two things, both
// purely about MODULE RESOLUTION mechanics — neither fakes or alters
// any actual business/timezone/date logic:
//
// 1. Intercepts the bare "server-only" import specifier and resolves it
//    to a virtual empty module. The real `server-only` npm package is
//    itself just a build-time guard (it throws only when a bundler
//    processes it into a CLIENT bundle; it is a no-op everywhere else)
//    and is not installed as a real dependency in this project at all —
//    Next's own bundler special-cases the literal specifier internally.
//
// 2. Resolves an extensionless RELATIVE specifier (e.g. `./local-time`,
//    written that way under this project's own "moduleResolution":
//    "bundler" convention, which — like Next's own bundler — resolves
//    such a specifier against the sibling `.ts` file automatically) by
//    trying the same specifier with a literal `.ts` extension appended.
//    Node's own native ESM resolver has no such convention (ESM
//    resolution requires an exact, existing file), so a `.ts` file that
//    imports ANOTHER `.ts` file via a real (non-type-only) extensionless
//    relative specifier cannot otherwise be loaded directly by
//    `node --test` at all. This ONLY changes how a specifier maps to a
//    file on disk; the imported module's own real, unmodified code is
//    what actually runs.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {};", shortCircuit: true };
  }

  if (specifier.startsWith(".") && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through to default resolution (e.g. a genuine directory
      // import or an extensionless specifier that isn't a local `.ts`
      // sibling) — never swallow a real error silently.
    }
  }

  return nextResolve(specifier, context);
}

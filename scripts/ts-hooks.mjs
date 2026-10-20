// Module resolve hooks so plain Node (with its built-in TypeScript type stripping) can run
// the app's lib/ code outside Next.js: maps "@/x" to the project root and finds .ts files
// for extensionless imports. Loaded by scripts/register-ts.mjs.

const root = new URL("..", import.meta.url);
const EXTENSIONS = [".ts", ".mts", ".mjs", ".js", "/index.ts"];

export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2), root).href;
  const local = /^(\.|\/|file:)/.test(spec);
  if (local && !/\.[cm]?[jt]sx?$|\.json$/.test(spec)) {
    for (const ext of EXTENSIONS) {
      try {
        return await next(spec + ext, context);
      } catch {}
    }
  }
  try {
    return await next(spec, context);
  } catch (err) {
    // Packages without an exports map ("next/server") need the file extension under ESM
    if (!local && /^[@\w][^:]*\/[^.]+$/.test(spec)) return next(`${spec}.js`, context);
    throw err;
  }
}

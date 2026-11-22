// A resolve hook for the processes this test spawns with `--conditions=source`. pi-schema 1.5.2's `source` condition
// names a file its tarball lacks, so its specifier resolves again without that condition. Everything else resolves as
// the command line says, so the child still loads our packages from `src/`.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@earendil-works/pi-schema")) {
    return next(specifier, {
      ...context,
      conditions: context.conditions.filter((condition) => condition !== "source"),
    });
  }
  return next(specifier, context);
}

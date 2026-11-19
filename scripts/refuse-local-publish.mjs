// Stops `npm publish` and `pnpm publish` run in a package folder. Each package's `prepublishOnly` script runs it. The
// packages are public, so without it a developer logged in to npm could publish 0.0.0 to `latest` from their machine.
// release.yml publishes the tarballs that `pack` built, and npm runs no lifecycle scripts for a tarball, so this
// script never runs there.
console.error(
  "Refusing to publish from this machine: the packages publish only from .github/workflows/release.yml, through " +
    "npm trusted publishing. See CONTRIBUTING.md.",
);
process.exit(1);

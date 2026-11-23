// A page that must show a TypeScript block of its own lists it here, as "<page path>#<n>" (the n-th TypeScript block on the page, counting from 1, so a line edited above it moves nothing) with the reason. Today none
// does. fences.test.ts lets a listed block skip the file-fence rule, and snippets.test.ts type-checks it instead.
export const EXCEPTIONS: ReadonlyMap<string, string> = new Map();

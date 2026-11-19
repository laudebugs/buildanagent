// A fixture example for the listing tests: a region, a region nested in it and a region inside a block.
// #region greet
export function greet(name: string): string {
  // #region message
  return `Hello, ${name}.`;
  // #endregion message
}
// #endregion

{
  // #region call
  const greeting = greet("reader");
  console.log(greeting);
  // #endregion
}

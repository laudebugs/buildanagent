// A fixture example for notes and replays: three lines that each end with a note marker.
const greet = (name: string): string => `Hello, ${name}.`;

// #region steps
const name = "reader"; // book:note name
const greeting = greet(name); // book:note greet
console.log(greeting); // book:note print

// #endregion

export {};

// Runs each numbered book example in examples/ as its own offline process and records its transcript; the shared
// runner in scripts/transcripts/book-examples.ts holds the rest.
import { fileURLToPath } from "node:url";
import { defineBookExamples } from "../../../scripts/transcripts/book-examples.js";

defineBookExamples({ packageDir: fileURLToPath(new URL("../", import.meta.url)), tempPrefix: "gateway" });

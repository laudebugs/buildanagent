import type { z } from "astro/zod";

/** Joins a zod error's issues into one line, each as `path: message`, for a problem report. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

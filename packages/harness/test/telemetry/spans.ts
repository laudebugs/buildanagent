// Test helpers: a real tracer behind an in-memory exporter, and the exported spans as a nested, comparable tree.
import { type ProjectSpansOptions, projectSpans } from "@buildanagent/harness/telemetry";
import type { SessionEntry } from "@buildanagent/protocol";
import { context, type Span, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";

export interface SpanTree {
  readonly name: string;
  readonly kind: number;
  readonly error: boolean;
  readonly durationMs: number;
  readonly attributes: Record<string, unknown>;
  readonly children: SpanTree[];
}

/** Projects `entries` into an in-memory exporter and returns the finished spans in export order. */
export async function exportSpans(
  entries: readonly SessionEntry[],
  options: Partial<Omit<ProjectSpansOptions, "tracer" | "childContext">> = {},
): Promise<ReadableSpan[]> {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  await projectSpans(entries, {
    tracer: provider.getTracer("test"),
    childContext: (parent) => trace.setSpan(context.active(), parent as Span),
    ...options,
  });
  await provider.forceFlush();
  return exporter.getFinishedSpans();
}

const durationMs = (span: ReadableSpan): number => span.duration[0] * 1000 + span.duration[1] / 1e6;

/** The spans as the tree their parent links make, children in start order, attributes sorted by name. */
export function treeOf(spans: readonly ReadableSpan[]): SpanTree {
  const nodes = new Map(
    spans.map((span) => [
      span.spanContext().spanId,
      {
        span,
        tree: {
          name: span.name,
          kind: span.kind,
          error: span.status.code === 2,
          durationMs: durationMs(span),
          attributes: Object.fromEntries(Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b))),
          children: [] as SpanTree[],
        },
      },
    ]),
  );
  let root: SpanTree | undefined;
  const ordered = [...nodes.values()].sort(
    (a, b) => a.span.startTime[0] - b.span.startTime[0] || a.span.startTime[1] - b.span.startTime[1],
  );
  for (const { span, tree } of ordered) {
    const parent = span.parentSpanContext === undefined ? undefined : nodes.get(span.parentSpanContext.spanId);
    if (parent === undefined) root = tree;
    else parent.tree.children.push(tree);
  }
  if (root === undefined) throw new Error("no root span");
  return root;
}

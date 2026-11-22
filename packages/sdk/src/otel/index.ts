/**
 * `@buildanagent/sdk/otel`: the OpenTelemetry observer. `otelObserver()` projects a run's events onto `gen_ai.*`
 * spans, with content off unless the caller turns it on, and exports only to the tracer the caller passes.
 *
 * @module @buildanagent/sdk/otel
 */
export {
  GEN_AI_ATTRIBUTES,
  GEN_AI_CONTENT_ATTRIBUTES,
  GEN_AI_OPERATIONS,
  SEMCONV_GENAI_COMMIT,
} from "./attributes.js";
export {
  blockPart,
  type ContentPart,
  jsonValue,
  resultParts,
  systemInstructionsJson,
} from "./content.js";
export {
  type AttributeValueLike,
  type OtelObserver,
  type OtelObserverOptions,
  otelObserver,
  type SpanLike,
  type SpanOptionsLike,
  type TracerLike,
} from "./observer.js";

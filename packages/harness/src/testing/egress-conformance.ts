/**
 * The egress conformance suite: what every sandbox egress backend and proxy must refuse. Requests to a host outside
 * `EgressPolicy.allow`, to loopback addresses (`127.0.0.1`, `[::1]`, `localhost`) and to cloud metadata endpoints
 * (`169.254.169.254`, `[fd00:ec2::254]`, `metadata.google.internal`, `100.100.100.200`) must all fail closed. The
 * cases import no test runner and no Node module, so local proxies and hosted sandbox backends share one suite.
 */
import { compileEgressPolicy } from "../credentials/egress-policy.js";
import { isHarnessError } from "../errors.js";
import { type CaseReport, type RunnableCase, runCases } from "./run-cases.js";

/** One target URL that an egress backend must refuse. */
export interface EgressDeniedTarget {
  readonly label: string;
  readonly url: string;
}

/** Addresses every egress backend must refuse when not explicitly allowlisted (and always for loopback/metadata). */
export const EGRESS_DENIED_TARGETS: readonly EgressDeniedTarget[] = [
  { label: "a host outside EgressPolicy.allow", url: "https://not-allowed.example.invalid/" },
  { label: "IPv4 loopback (127.0.0.1)", url: "https://127.0.0.1/" },
  { label: "IPv6 loopback ([::1])", url: "https://[::1]/" },
  { label: "localhost", url: "https://localhost/" },
  { label: "AWS/GCP/Azure metadata (169.254.169.254)", url: "http://169.254.169.254/latest/meta-data/" },
  { label: "HTTPS link-local metadata (169.254.169.254)", url: "https://169.254.169.254/latest/meta-data/" },
  { label: "AWS IPv6 metadata ([fd00:ec2::254])", url: "http://[fd00:ec2::254]/latest/meta-data/" },
  { label: "GCP metadata hostname", url: "http://metadata.google.internal/computeMetadata/v1/" },
  { label: "Alibaba Cloud metadata (100.100.100.200)", url: "http://100.100.100.200/latest/meta-data/" },
];

/** Outcome of one outbound request probe against an egress backend. */
export interface EgressProbeResult {
  /** `true` only when the request reached the target; `false` when the policy or proxy refused it. */
  readonly allowed: boolean;
  /** Optional diagnostic detail (HTTP status or refusal reason) shown if a case fails. */
  readonly detail?: string;
}

/** What an egress factory returns for one conformance run. */
export interface EgressUnderTest {
  /** Attempts one outbound request to `targetUrl` through the backend under test and reports whether it was allowed. */
  readonly probe: (targetUrl: string) => Promise<EgressProbeResult>;
  /** Optional allowlisted URL that should succeed, verifying the backend is live rather than totally disconnected. */
  readonly allowedUrl?: string;
  /** Optional cleanup run after each case. */
  readonly dispose?: () => Promise<void> | void;
}

/** Makes a fresh egress backend (or attaches to one) for each case. */
export type EgressFactory = () => EgressUnderTest | Promise<EgressUnderTest>;

/** One case of the egress conformance suite. */
export type EgressCase = RunnableCase;

/** The report the egress conformance suite returns. */
export type EgressConformanceReport = CaseReport;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Egress conformance: ${message}`);
}

/** The egress conformance cases, exported for the local proxy and every hosted sandbox backend. */
export function egressConformanceCases(factory: EgressFactory): readonly EgressCase[] {
  const withBackend = (
    name: string,
    body: (under: EgressUnderTest) => Promise<{ readonly skipped: string } | undefined>,
  ): EgressCase => ({
    name,
    run: async () => {
      const under = await factory();
      try {
        return await body(under);
      } finally {
        await under.dispose?.();
      }
    },
  });

  const deniedCases: EgressCase[] = EGRESS_DENIED_TARGETS.map((target) =>
    withBackend(`denies ${target.label}`, async ({ probe }) => {
      const result = await probe(target.url);
      check(
        result.allowed === false,
        `expected ${target.url} to fail closed, but it was allowed (${result.detail ?? "no detail"})`,
      );
      return undefined;
    }),
  );

  const policyCase: EgressCase = {
    name: "compileEgressPolicy refuses address literals and wildcards in allow",
    run: async () => {
      for (const bad of ["169.254.169.254", "127.0.0.1", "[::1]", "*.example.com"]) {
        let threw = false;
        try {
          await compileEgressPolicy({ allow: [bad], routes: [] }, { secret: async () => "unused" });
        } catch (err) {
          threw = isHarnessError(err) && err.code === "invalid_egress_options";
        }
        check(threw, `compileEgressPolicy must refuse "${bad}" with invalid_egress_options`);
      }
      return undefined;
    },
  };

  const allowedCase = withBackend(
    "allows a host explicitly listed on EgressPolicy.allow",
    async ({ probe, allowedUrl }) => {
      if (allowedUrl === undefined) {
        return { skipped: "factory supplied no allowedUrl to probe" };
      }
      const result = await probe(allowedUrl);
      check(result.allowed === true, `expected ${allowedUrl} to be allowed (${result.detail ?? "no detail"})`);
      return undefined;
    },
  );

  return [policyCase, ...deniedCases, allowedCase];
}

/** Runs every egress conformance case and reports which passed, skipped and failed. */
export function runEgressConformance(factory: EgressFactory): Promise<EgressConformanceReport> {
  return runCases(egressConformanceCases(factory));
}

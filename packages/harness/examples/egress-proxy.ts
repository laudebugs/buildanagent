// The egress proxy on the host: it names a credential and never holds one, hands the sandbox a placeholder in its
// place and refuses every host that is not listed. This example starts the proxy and asks it for an unlisted host.
import {
  compileEgressPolicy,
  type EgressPolicy,
  type EgressRecord,
  startEgressProxy,
} from "@buildanagent/harness/credentials";

// #region policy
// A sandbox may tunnel to the package registry. A git route lets it push to branches under agent/ in one repository,
// with the credential that the host reads under the name GITHUB_TOKEN.
const policy: EgressPolicy = {
  allow: ["registry.npmjs.org"],
  routes: [
    {
      kind: "git",
      route: "git",
      host: "github.com",
      repositories: ["acme/app"],
      pushRefs: ["refs/heads/agent/*"],
      credential: "GITHUB_TOKEN",
    },
  ],
};
// #endregion

/** What the host sees: the placeholder the sandbox gets, why an unlisted host was refused and the log's records. */
export interface ProxyDemo {
  readonly placeholder: string | undefined;
  readonly refusal: string;
  readonly records: readonly EgressRecord[];
}

/** Starts the proxy, asks it for a host that is not listed and stops it. `secret` reads a credential on the host. */
export async function tryProxy(secret: (name: string) => Promise<string>): Promise<ProxyDemo> {
  const records: EgressRecord[] = [];
  // #region proxy
  const compiled = compileEgressPolicy(policy, { secret });
  const proxy = await startEgressProxy({ ...compiled, log: (record) => records.push(record) });
  // #endregion
  try {
    // #region refused
    // The proxy refuses a host that is not in `allow` before it opens a connection.
    const refusal = await proxy.fetch("https://evil.example/").then(
      () => "reached it",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    // #endregion
    return { placeholder: proxy.sentinels.git, refusal, records };
  } finally {
    await proxy.close();
  }
}

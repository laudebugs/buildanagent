/**
 * Offline guards for every test in `packages/` (SDK plan §5.4).
 *
 * Tests must never reach a real model provider. The guards refuse any `fetch` to a non-loopback host, and they fail
 * fast when a provider key variable is set, so a misconfigured machine cannot send a test to a real provider.
 */

/** Environment variables that hold real provider credentials. Their presence fails the test run. */
export const PROVIDER_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True for hosts that resolve to this machine: `localhost`, `*.localhost`, 127.0.0.0/8 and `::1`. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Throws if any provider key variable is set in `env`. */
export function assertNoProviderKeys(env: Record<string, string | undefined> = process.env): void {
  const present = PROVIDER_KEY_VARIABLES.filter((name) => env[name] !== undefined && env[name] !== "");
  if (present.length > 0) {
    throw new Error(
      `Refusing to run tests with provider credentials set (${present.join(", ")}). Unset them; tests run offline.`,
    );
  }
}

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

/** Wraps `fetch` so that only loopback hosts are reachable. */
export function guardedFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    if (!isLoopbackHost(url.hostname)) {
      throw new Error(`Blocked outbound request to ${url.host}: tests may only reach loopback hosts.`);
    }
    return inner(input, init);
  };
}

let installed = false;

/** Installs the guards once per process: checks provider keys and replaces `globalThis.fetch`. */
export function installTestGuards(): void {
  if (installed) return;
  assertNoProviderKeys();
  globalThis.fetch = guardedFetch(globalThis.fetch.bind(globalThis));
  installed = true;
}

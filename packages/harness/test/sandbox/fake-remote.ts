import { HarnessError } from "@buildanagent/harness";
import {
  confirmPolicy,
  type ExecOptions,
  type ExecResult,
  type Sandbox,
  type SandboxCapability,
  type SandboxClient,
  type SandboxPolicy,
  type SandboxStop,
  type SandboxTier,
  type WorkspaceManifest,
} from "@buildanagent/harness/sandbox";
import { fakeSandbox } from "@buildanagent/harness/testing";

// An in-memory stand-in for a hosted backend such as E2B: it keeps sandboxes by id between calls, so it can pause,
// snapshot and resume them, and it reads back the policy "the provider" applied, which `override` can change the way an
// account-wide setting would. Each sandbox runs on an in-memory fake, so it enforces the applied policy, not the
// requested one.

/** The options of `fakeRemoteSandbox()`. */
export interface FakeRemoteOptions {
  readonly tier?: SandboxTier;
  /** The stops the client claims. Defaults to all three, which a microVM with a closed allowlist delivers. */
  readonly stops?: readonly SandboxStop[];
  readonly capabilities?: readonly SandboxCapability[];
  /** The policy the provider applies instead of the requested one. */
  readonly override?: (requested: SandboxPolicy) => SandboxPolicy;
}

interface Record {
  readonly root: string;
  readonly inner: Sandbox;
  paused: boolean;
  disposed: boolean;
  readonly applied: SandboxPolicy;
}

/** A fake hosted backend, and what it holds. */
export interface FakeRemoteClient extends SandboxClient {
  /** The ids of the sandboxes still held, paused or not. */
  held(): readonly string[];
}

class RemoteHandle implements Sandbox {
  readonly id: string;
  stops: readonly SandboxStop[] = [];
  private readonly record: Record;
  private readonly remote: FakeRemote;

  constructor(id: string, record: Record, remote: FakeRemote) {
    this.id = id;
    this.record = record;
    this.remote = remote;
  }

  private running(): Sandbox {
    if (this.record.disposed) throw new HarnessError("sandbox_disposed", "the sandbox was disposed");
    if (this.record.paused) throw new HarnessError("invalid_sandbox_options", "the sandbox is paused");
    return this.record.inner;
  }

  exec(command: readonly string[], options: ExecOptions): Promise<ExecResult> {
    return Promise.resolve().then(() => this.running().exec(command, options));
  }

  readFile(path: string): Promise<Uint8Array> {
    return Promise.resolve().then(() => this.running().readFile(path));
  }

  writeFile(path: string, data: Uint8Array): Promise<void> {
    return Promise.resolve().then(() => this.running().writeFile(path, data));
  }

  async readBack(): Promise<SandboxPolicy> {
    if (this.record.disposed) throw new HarnessError("sandbox_disposed", "the sandbox was disposed");
    return structuredClone(this.record.applied) as SandboxPolicy;
  }

  async snapshot(): Promise<string> {
    this.running();
    return this.remote.snapshot(this.record);
  }

  async pause(): Promise<void> {
    this.running();
    this.record.paused = true;
  }

  async dispose(): Promise<void> {
    if (this.record.disposed) return;
    this.record.disposed = true;
    this.remote.forget(this.id);
    await this.record.inner.dispose();
  }
}

class FakeRemote {
  private count = 0;
  private readonly sandboxes = new Map<string, Record>();
  private readonly snapshots = new Map<string, { root: string; files: ReadonlyMap<string, Uint8Array> }>();
  private readonly files = new Map<Sandbox, () => ReadonlyMap<string, Uint8Array>>();
  readonly options: FakeRemoteOptions;
  readonly client: FakeRemoteClient;

  constructor(options: FakeRemoteOptions) {
    this.options = options;
    this.client = {
      tier: options.tier ?? "microvm",
      stops: options.stops ?? ["mistakes", "exfiltration", "hostile_process"],
      capabilities: options.capabilities ?? ["resume", "snapshot", "pause"],
      held: () => this.held(),
      provision: (manifest, policy) => this.start(manifest, policy),
      resume: (id, policy) => this.resume(id, policy),
    };
  }

  held(): readonly string[] {
    return [...this.sandboxes.keys()];
  }

  forget(id: string): void {
    this.sandboxes.delete(id);
  }

  snapshot(record: Record): string {
    this.count += 1;
    const id = `snap-${this.count}`;
    this.snapshots.set(id, { root: record.root, files: new Map(this.files.get(record.inner)?.() ?? []) });
    return id;
  }

  /** Starts a sandbox on a fresh in-memory fake, under the policy the provider applies, and checks the read-back. */
  async start(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox> {
    const applied = this.options.override?.(policy) ?? policy;
    // The backing fake claims no stop of its own, so the remote's read-back, not the fake's, decides what is delivered.
    const backing = fakeSandbox({ stops: [] });
    const inner = await backing.provision(manifest, applied);
    this.files.set(inner, () => backing.files());
    this.count += 1;
    const id = `sbx-${this.count}`;
    const record: Record = { root: manifest.root, inner, paused: false, disposed: false, applied };
    this.sandboxes.set(id, record);
    const handle = new RemoteHandle(id, record, this);
    handle.stops = await confirmPolicy(this.client, handle, policy);
    return handle;
  }

  async resume(id: string, policy: SandboxPolicy): Promise<Sandbox> {
    const snapshot = this.snapshots.get(id);
    if (snapshot !== undefined) {
      return this.start({ root: snapshot.root, files: Object.fromEntries(snapshot.files) }, policy);
    }
    const record = this.sandboxes.get(id);
    if (record === undefined) throw new HarnessError("sandbox_not_found", "no sandbox has that id");
    record.paused = false;
    const handle = new RemoteHandle(id, record, this);
    handle.stops = await confirmPolicy(this.client, handle, policy);
    return handle;
  }
}

/** Builds the fake hosted backend: a `microvm` with every capability unless the options say otherwise. */
export function fakeRemoteSandbox(options: FakeRemoteOptions = {}): FakeRemoteClient {
  return new FakeRemote(options).client;
}

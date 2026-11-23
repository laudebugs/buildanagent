// The service worker's entry: it wires OfflineWorker (worker.ts) to the worker's events. scripts/offline-build.mjs
// bundles this file into dist/sw.js as one classic script with no imports, and puts the build's file list above it as
// __MANUAL_OFFLINE__, so every build's worker differs byte for byte and the browser installs it as an update.
import { fromBookWindow, type InboundMessage, type MessageSource, type OfflineBuild, OfflineWorker } from "./worker.js";

declare const __MANUAL_OFFLINE__: OfflineBuild;

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  readonly clientId: string;
  readonly resultingClientId: string;
  respondWith(response: Promise<Response>): void;
}

interface MessageEventLike extends ExtendableEventLike {
  readonly data: InboundMessage | unknown;
  readonly origin: string;
  readonly ports: readonly MessagePort[];
  readonly source: (MessageSource & { postMessage(message: unknown): void }) | null;
}

interface ServiceWorkerScopeLike {
  readonly location: Location;
  readonly caches: CacheStorage;
  readonly clients: {
    matchAll(options: { includeUncontrolled: boolean; type: "all" }): Promise<readonly { readonly id: string }[]>;
  };
  // Both are missing in some browsers, so each is read with care.
  readonly serviceWorker?: { readonly state: string };
  readonly registration?: {
    readonly active: { readonly state: string } | null;
    readonly waiting: unknown;
    readonly installing: unknown;
  };
  fetch(request: Request): Promise<Response>;
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}

const scope = self as unknown as ServiceWorkerScopeLike;
const worker = new OfflineWorker(__MANUAL_OFFLINE__, {
  origin: scope.location.origin,
  caches: scope.caches,
  fetch: (request) => scope.fetch(request),
  openClients: async () =>
    (await scope.clients.matchAll({ includeUncontrolled: true, type: "all" })).map((client) => client.id),
  isActive,
});

// Whether this worker is the active one, as far as the browser says: its own state where the browser exposes it, and
// otherwise true when the registration has an activated worker and none installing or waiting, so the running worker
// can only be that one. Undefined leaves the worker to its pending record.
function isActive(): boolean | undefined {
  if (scope.serviceWorker) return scope.serviceWorker.state === "activated";
  const registration = scope.registration;
  if (!registration) return undefined;
  if (registration.active?.state === "activated" && !registration.waiting && !registration.installing) return true;
  return undefined;
}

// No skipWaiting here: a new build waits until the reader presses Reload in the update notice, so an open page never
// switches builds under the reader.
scope.addEventListener("install", (event) => event.waitUntil(worker.install()));
scope.addEventListener("activate", (event) => event.waitUntil(worker.activate()));

scope.addEventListener("fetch", (event) => {
  const response = worker.handleFetch(event);
  if (response) event.respondWith(response);
});

scope.addEventListener("message", (event) => {
  if (!fromBookWindow(scope.location.origin, event)) return;
  const reply = event.ports[0] ?? event.source;
  const post = (message: unknown) => reply?.postMessage(message);
  // waitUntil keeps the worker alive for the whole of a SAVE_ALL, which posts its progress as it goes.
  event.waitUntil(
    worker.handleMessage(event.data, { post }).then(async (outcome) => {
      if (outcome?.type === "SKIP_WAITING") await scope.skipWaiting();
      else if (outcome) post(outcome);
    }),
  );
});

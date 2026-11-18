# 0038. Generate agents on our SDK by default once it ships, and on verified third-party SDKs until then and as options

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-agent-platform.md, PF2](../plans/build-agent-platform.md#pf2-our-sdk-by-default-once-it-ships-plus-verified-third-party-sdks-accepted)

## Context

The owner chose "Ours, plus verified third-party" for the SDK that generated agents use. Our SDK and harness are planned but unbuilt (milestones M5 and M6). Two SDKs already have verified references, pinned in `verify/`: Cloudflare `agents` 0.33.0 and the Vercel AI SDK `ai` 7.0.162. The [agent-building platforms report](../research/deployment/agent-building-platforms.md#where-a-new-platform-could-win-what-it-must-match-and-the-first-slice) recommended generating against an already verified SDK, Cloudflare first and Vercel second. Generating against an unbuilt SDK would repeat the drift problem the platform exists to solve.

## Decision

M8 generates against Cloudflare `agents` 0.33.0 and `ai` 7.0.162 at their exact pins. Once M5 and M6 ship, our SDK and harness become the default target on Cloudflare, AWS and Vercel, and the third-party SDKs stay as options. A new SDK, or a new version of a supported one, becomes a target only after it passes the eight-step reference process in [AGENTS.md](../../AGENTS.md#process-for-documenting-an-sdk).

## Consequences

- Generation templates (F6) pin exact versions, and the gate (F3) type-checks against the same pins.
- Todo F18 switches the default to our SDK; it depends on B20 and N45.
- An SDK upgrade is a reference round first, then a template change.

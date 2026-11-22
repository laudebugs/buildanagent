# Fact-check: the website app

This log checks the claims that the pages of `apps/site` make on 2026-11-22 (todo L7), and the version it pins. Each claim restates what a package README, a `package.json` or a licence file says, so each row names that primary source.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| L7-1 | Astro 7.4.11 is at least a week old | `package.json` | ✅ | `npm view astro time`, read 2026-11-22: 7.4.11 was published 2026-11-11. The docs app and the book pin the same release |
| L7-2 | buildanagent is two TypeScript packages, a gateway that talks to model providers and an SDK that runs the loop over it | Landing page | ✅ | `packages/gateway/README.md` and `packages/sdk/README.md`, first paragraphs; both packages are TypeScript ESM (`"type": "module"`, `src/**/*.ts`) |
| L7-3 | Both packages are alphas, installed under the `alpha` tag | Landing page, package pages | ✅ | `npm view @buildanagent/sdk dist-tags`, read 2026-11-22: `alpha` is `0.1.0-alpha.23` and `latest` is the placeholder `0.0.0-bootstrap.0`; the same for the gateway through the fixed version group in `.changeset/config.json` |
| L7-4 | Your agent code stays the same when you switch providers, through one transcript and one stream format | Landing page, gateway page | ✅ | Gateway README, first paragraph: "so switching providers never changes your agent code" |
| L7-5 | A failed model call or a broken tool never makes a run throw, and every run ends with a stop reason | Landing page, SDK page | ✅ | SDK README, "Every run ends with a stop reason": "A failed model call or a failing tool never makes a run throw" |
| L7-6 | A dollar budget, a progress policy and a depth cap stop a runaway run | Landing page, SDK page | ✅ | SDK README, "Three guards stop a runaway run" |
| L7-7 | A gate can hold a tool call until a person answers, and a signed request lets any process that holds the key resume it | Landing page, SDK page | ✅ | SDK README, "A gate that asks ends the run with a signed pending request" and "Pass `hmacSigner()` wherever a pause may resume in another process" |
| L7-8 | A scripted model plays back the answers you script, needs no API key, gives the same result every run and fails when a test drifts from the script | Landing page, SDK page | ✅ | SDK README, "Test against a strict scripted model" and "Tests give the same result every run" |
| L7-9 | The gateway has two adapters: Anthropic's Messages API, and Chat Completions for OpenAI and servers that copy it | Gateway page | ✅ | `packages/gateway/package.json` exports `./anthropic` and `./openai-chat`; the README's adapter sections |
| L7-10 | The gateway prices each response from a replaceable catalog, and an unknown price is `null`, never a guessed zero | Gateway page | ✅ | Gateway README, "Every message carries its cost, priced from a catalog you can replace" and "A conversation is a list of messages you own" (`Cost.total` is `null` when the price is unknown) |
| L7-11 | A failed request is retried only before the model streams output, so a retry never repeats text you already showed | Gateway page | ✅ | Gateway README, "Retries happen only before the model streams output": "once a content event has reached you, the gateway never retries, because a second attempt would replay text you have already seen" |
| L7-12 | You pass a key to each adapter, and the gateway never reads one from the environment | Gateway page | ✅ | Gateway README, "Your key is the only key the gateway sends" |
| L7-13 | A transcript recorded on one model replays on another, even from another provider | Gateway page | ✅ | Gateway README, "A transcript recorded on one model replays on another" |
| L7-14 | The gateway needs Node 22 or later, and the SDK needs Node 22.19 or later | Package pages | ✅ | `engines.node` is `>=22` in `packages/gateway/package.json` and `>=22.19.0` in `packages/sdk/package.json` |
| L7-15 | The SDK validates the model's arguments against your schema, and a bad call returns an error the model can fix | SDK page | ✅ | SDK README, "A failed call becomes an error the model can fix" |
| L7-16 | The code is licensed Apache-2.0 OR MIT, and the content on the site and in the docs is CC BY 4.0 | Footer | ✅ | `LICENSE`: code is "Apache-2.0 OR MIT, at your option" and documentation is "CC BY 4.0"; both packages' `license` is `Apache-2.0 OR MIT`. The branch adds the site's code and pages to the lists in `LICENSE` |

**Totals:** 16 claims: 16 ✅, 0 ✏️, 0 ⚠️.

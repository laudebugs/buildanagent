# Third-party notices: nine mirrored doc sets keep their upstream licences, the book credits the garment engineering textbook, and its fonts keep the OFL

This repository contains upstream documentation that other projects wrote. Our own code and docs are licensed as [LICENSE](LICENSE) describes, but that licence does not cover the mirrors under `docs/reference/*/source/`. Each mirror is an unmodified copy of upstream files at a recorded tag or commit, and each keeps its upstream licence file beside it. If you reuse a mirrored file, follow the licence in its row below. The book also adapts code from the owner's garment engineering textbook, and those files carry Apache-2.0 alone instead of our usual choice of two licences. The book serves three font families under the SIL Open Font License 1.1.

## Each mirror's licence comes from its upstream repository

The rows below come from each mirror's `_manifest.json` (repository, tag, commit) and its licence file, both read on 2026-11-18. Commits are shortened to 12 characters; the manifests hold the full hashes. "No tag" means the upstream docs site renders a branch, so the mirror is pinned to a commit instead of a release.

| Mirror | Upstream repository | Tag (commit) | Licence |
|---|---|---|---|
| [`docs/reference/pi/source/`](docs/reference/pi/source/) | [earendil-works/pi](https://github.com/earendil-works/pi) | `v1.5.2` (`b4afdddf44e0`) | MIT ([LICENSE](docs/reference/pi/source/LICENSE)) |
| [`docs/reference/openai-agents-sdk/source/`](docs/reference/openai-agents-sdk/source/) | [openai/openai-agents-js](https://github.com/openai/openai-agents-js) | `v0.21.0` (`304e436185ad`) | MIT ([LICENSE](docs/reference/openai-agents-sdk/source/LICENSE)) |
| [`docs/reference/vercel-ai-sdk/source/`](docs/reference/vercel-ai-sdk/source/) | [vercel/ai](https://github.com/vercel/ai) | `ai@7.0.162` (`2feaeecbd6a9`) | Apache-2.0 ([LICENSE](docs/reference/vercel-ai-sdk/source/LICENSE)) |
| [`docs/reference/langchain/source/`](docs/reference/langchain/source/) | [langchain-ai/docs](https://github.com/langchain-ai/docs) | commit `9d9747d0cf24` (no tag) | MIT ([LICENSE](docs/reference/langchain/source/LICENSE)) |
| [`docs/reference/copilot-sdk/source/`](docs/reference/copilot-sdk/source/) | [github/copilot-sdk](https://github.com/github/copilot-sdk) | `v1.0.31` (`15de061c7c87`) | MIT ([LICENSE](docs/reference/copilot-sdk/source/LICENSE)) |
| [`docs/reference/google-adk/source/adk-docs/`](docs/reference/google-adk/source/adk-docs/) | [google/adk-docs](https://github.com/google/adk-docs) | commit `ff7a5f56469a` (no tag) | Apache-2.0 ([LICENSE](docs/reference/google-adk/source/adk-docs/LICENSE)) |
| [`docs/reference/google-adk/source/adk-js/`](docs/reference/google-adk/source/adk-js/) | [google/adk-js](https://github.com/google/adk-js) | `main-v2.5.0` (`b1b94c0d501c`) | Apache-2.0 ([LICENSE](docs/reference/google-adk/source/adk-js/LICENSE)) |
| [`docs/reference/cloudflare-agents/source/agents/`](docs/reference/cloudflare-agents/source/agents/) | [cloudflare/agents](https://github.com/cloudflare/agents) | `agents@0.33.0` (`5684e278e44a`), `@cloudflare/think@0.23.0` (`be1749221ab3`), `@cloudflare/ai-chat@0.12.2` (`fc7f59fb00e7`) | MIT ([LICENSE](docs/reference/cloudflare-agents/source/agents/LICENSE)) |
| [`docs/reference/cloudflare-agents/source/cloudflare-docs/`](docs/reference/cloudflare-agents/source/cloudflare-docs/) | [cloudflare/cloudflare-docs](https://github.com/cloudflare/cloudflare-docs) | `production` branch, commit `6897a9fa0c11` | CC BY 4.0 ([LICENSE](docs/reference/cloudflare-agents/source/cloudflare-docs/LICENSE)); MIT (code, [LICENSE-CODE](docs/reference/cloudflare-agents/source/cloudflare-docs/LICENSE-CODE)); see [ATTRIBUTION.md](docs/reference/cloudflare-agents/source/cloudflare-docs/ATTRIBUTION.md) |

## The book reuses code from the garment engineering textbook, under Apache-2.0 only

The book in `apps/manual/` copies or adapts code from the owner's garment engineering textbook, the private repository `tajistudios/garment-engineering-textbook`. The owner gave permission to reuse that code here on 2026-11-19, and asked for this credit ([ADR 0054](docs/decisions/0054-reuse-garment-textbook-code.md)). The repository has no licence file of its own, so every derived file is published under the Apache License, Version 2.0 only ([LICENSE-APACHE](LICENSE-APACHE)), not under the Apache-2.0 OR MIT terms of our other code. Each derived file opens with a header comment that names its source, the commit and that licence. The table lists every derived file:

| File here | Source file | Commit | What it takes |
|---|---|---|---|
| [`apps/manual/astro.config.mjs`](apps/manual/astro.config.mjs) | `astro.config.mjs` | `bca44b0` | The render-input hash that deletes Astro's content cache when a Markdown plugin or its data changes, and the dev-server restart on those files |

No file here copies the textbook repository's personal or account data, or text from its agent rules.

## The book's three fonts are subsets of OFL fonts from google/fonts

The book in `apps/manual/` serves its own fonts, so a reader's browser fetches nothing from Google. Each family comes from the [google/fonts](https://github.com/google/fonts) repository at commit `9bbbcda6f8aa91198223c77345d548af4b61940d` (2026-11-11), and [`apps/manual/fonts/sources.json`](apps/manual/fonts/sources.json) records the SHA-256 of every upstream file. The served files are WOFF2 subsets that keep Latin, punctuation, arrows, maths and box-drawing characters. A subset is a Modified Version under the SIL Open Font License 1.1, so each stays under that licence, and each family's unchanged `OFL.txt` ships beside its files. The subsets are written by [`apps/manual/scripts/subset-fonts.py`](apps/manual/scripts/subset-fonts.py) with fontTools 4.68.0.

| Served files | Derived from | Upstream path | Licence |
|---|---|---|---|
| [`apps/manual/public/fonts/instrument-serif/`](apps/manual/public/fonts/instrument-serif/) | Instrument Serif, Regular and Italic | `ofl/instrumentserif/` | OFL-1.1 ([OFL.txt](apps/manual/public/fonts/instrument-serif/OFL.txt)), copyright 2022 The Instrument Serif Project Authors |
| [`apps/manual/public/fonts/literata/`](apps/manual/public/fonts/literata/) | Literata, variable roman and italic | `ofl/literata/` | OFL-1.1 ([OFL.txt](apps/manual/public/fonts/literata/OFL.txt)), copyright 2017 The Literata Project Authors |
| [`apps/manual/public/fonts/manual-code/`](apps/manual/public/fonts/manual-code/) | Google Sans Code, variable roman and italic | `ofl/googlesanscode/` | OFL-1.1 ([OFL.txt](apps/manual/public/fonts/manual-code/OFL.txt)), copyright 2025 The Google Sans Code Project Authors; see [TRADEMARKS.md](apps/manual/public/fonts/manual-code/TRADEMARKS.md) |

None of the three licences names a Reserved Font Name. Google Sans Code's `TRADEMARKS.md` adds one rule that matters here: "Google", "Google Sans" and "Google Sans Code" are trademarks of Google LLC, and the "Google Sans Code" mark may be used only in connection with the original font software. The book's files are derived from Google Sans Code, not the original, so they carry the neutral family name "Manual Code" in their file names, their CSS and their name tables. The subsetting script also drops the records that name Google as the manufacturer and vendor, and keeps the copyright, trademark notice, designer and licence records. Nothing in the book implies that Google made or endorses these files.

## Quotations elsewhere are short, attributed excerpts

Two kinds of third-party text appear outside the mirrors, both as short quotations with attribution. First, the practitioner research in [`docs/research/practitioners/`](docs/research/practitioners/) quotes Hacker News comments, each credited to its author with a link to the comment. The raw comment corpus stays in a gitignored folder, so the repo does not distribute it ([corpus.md](docs/research/practitioners/corpus.md)). Second, [`twelve-factor-agents.md`](docs/research/external-designs/twelve-factor-agents.md) quotes HumanLayer's "12-factor agents" essay, whose prose is licensed CC BY-SA 4.0; because of that share-alike term, the repo quotes the essay briefly and does not mirror it. These quotations remain the work of their authors.

## The Claude Agent SDK docs are not distributed

Anthropic's Claude Agent SDK docs are not openly licensed, so this repository leaves them out. Their mirror path, `docs/reference/claude-agent-sdk/source/`, is gitignored, and anyone who needs a local copy regenerates it with `pnpm run fetch-docs` in `verify/claude-agent-sdk/` ([reference README](docs/reference/claude-agent-sdk/README.md#regenerate-the-mirror-and-re-verify)).

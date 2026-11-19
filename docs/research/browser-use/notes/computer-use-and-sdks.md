# Model-side computer-use and browser tools, and how agent SDKs expose them (as of November 2026)

Research notes, 2026-11-18. Working material for the browser-use report. Vendor doc pages were read through WebFetch, which summarises long pages with a small model; pages read that way are marked "(WebFetch summary)". Where a page could be downloaded as Markdown (OpenAI) or an npm tarball could be grepped (SDK type definitions), the finding comes from the raw text. Nothing downloaded was installed or run.

## Anthropic: computer use, browser use, Claude in Chrome and the web tools

### Takeaway
As of November 2026, Anthropic has two GA client toolsets with no beta header: `computer_toolset_20260801` (17 desktop actions on screenshots) and `browser_toolset_20260801` (31 browser actions, using accessibility-tree refs as well as coordinates). The older `computer_20251124` and `computer_20250124` tools are still beta, need a beta header, and are refused on the Claude API by Opus 5.5 and Sonnet 5.5. Your application always performs the actions. Prompt-injection classifiers scan what the tools return, and Anthropic's published best-of-N attack success rate is about 1–2% with safeguards on (data from November 2025).

### Cited Findings
**Computer toolset (current)**
- Type `computer_toolset_20260801`, no beta header ("The request needs no beta header"). The tools entry has no `name`. It cannot be declared alongside `computer_20251124` or a custom tool named `computer`, and it is not available in Claude Managed Agents. The example requests use `anthropic-version: 2026-10-21`. — [Computer use tool (WebFetch summary)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- Models: Claude Fable 5.2, Mythos 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5. On the Claude API these return a 400 for `computer_20251124`, but on Amazon Bedrock they still accept `computer_20251124` with the `computer-use-2025-11-24` beta. — [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- 17 members, all on by default: `screenshot`, `zoom` (`region: [x0,y0,x1,y1]`), `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click` (optional `coordinate`, plus modifier keys in `text`), `left_click_drag`, `mouse_move`, `left_mouse_down`, `left_mouse_up`, `cursor_position`, `scroll` (`scroll_direction`, `scroll_amount`), `type`, `key` (`repeat` 1–100), `hold_key` and `wait` (each up to 300 s). Per-member settings go in `configs` (`enabled`, `defer_loading`). — [Computer use tool (WebFetch summary)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- Wire shape: each action arrives as its own `tool_use` block, with `name` set to the action and `"toolset_name": "computer"`. The input has no `action` field. Each `tool_result` must echo `toolset_name` and may contain only `text` and `image`. Claude can batch several actions in one turn. Run them in order; if one fails, answer every later action with "Not executed: an earlier computer action in this turn failed." A request that leaves any `tool_use` unanswered fails with `invalid_request_error`. — [Computer use tool, "Migrate from computer_20251124"](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#earlier-tool-versions)
- Coordinates are screenshot pixels, origin top-left, and zoom does not change the coordinate space. The toolset drops `display_width_px`, `display_height_px`, `display_number` and `enable_zoom`. It rejects an image over the model's limits rather than downscaling it, so the client must resize and rescale. Image limits for Opus 4.7 and later: 2,576 px on the long edge and 4,784 visual tokens (about 3.75 MP); earlier models allow 1,568 px and about 1.15 MP. Recommended screen sizes: 1024x768 or 1280x720 for desktops, 1280x800 or 1366x768 for web apps; avoid anything above 1920x1080. — [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- Token overhead: declaring the toolset with its default members adds about 4,500 input tokens (about 4,590 on Sonnet 5, about 4,520 on the other models), and disabling `zoom` saves about 410. The earlier versions add 466–499 system-prompt tokens plus about 735 tokens per tool definition (measured with `computer_20250124`). Screenshots are billed as image input, at roughly 1,000–1,800 tokens each. — [Computer use tool, Pricing](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- Who executes: "Computer use is a client-side tool. All screenshots, mouse actions, keyboard inputs … are captured and stored in your environment, not by Anthropic." This makes it ZDR-eligible and HIPAA-eligible. — [Computer use tool, Data retention](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- Safety: classifiers scan tool returns such as screenshots and, when they flag a likely injection, steer the model to check the instruction with the user. Opting out requires contacting support. The docs also recommend a dedicated low-privilege VM, no credentials, a domain allowlist and human confirmation of consequential actions. — [Computer use tool (WebFetch summary)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

**Earlier versions (beta)**
- `computer_20251124` takes beta header `computer-use-2025-11-24` and works with Fable 5.1, Mythos 5.1, Fable 5, Mythos 5, Opus 5, Sonnet 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6 and Opus 4.5. `computer_20250124` takes `computer-use-2025-01-24` and works with Sonnet 4.5 (deprecated), Haiku 4.5, and Opus 4.1, Sonnet 4 and Opus 4 (retired except on some clouds). — [Computer use tool, Earlier tool versions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#earlier-tool-versions)
- Discrepancy: the Vercel AI SDK provider page at `ai@7.0.162` says to use the toolset for "Sonnet 5.5 and Opus 5.5 (required), Opus 5, Sonnet 5, Fable 5, Fable 5.1, and Opus 4.8", whereas Anthropic lists those last five under `computer_20251124`. — local `docs/reference/vercel-ai-sdk/source/content/providers/01-ai-sdk-providers/05-anthropic.mdx:1454`; contrast with [Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#earlier-tool-versions)

**Browser toolset (new)**
- Type `browser_toolset_20260801`, stable, with no beta header named. The same 13 models support it. It is not available in Managed Agents. — [Browser use tool (WebFetch summary)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
- 31 members, four of them off by default (`javascript_exec`, `file_upload`, `read_console`, `read_network`):
  - navigation and capture: `navigate`, `screenshot`, `zoom`
  - pointer: `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `hover`, `left_click_drag`, `left_mouse_down`, `left_mouse_up`, `mouse_move`, `scroll`, `scroll_to`
  - keyboard and timing: `type`, `key`, `hold_key`, `wait`
  - page reading: `read_page`, `find`, `get_page_text`
  - forms and files: `form_input`, `file_upload`
  - diagnostics: `read_console`, `read_network`, `javascript_exec`
  - tabs: `new_tab`, `list_tabs`, `switch_tab`, `close_tab`

  — [Browser use tool (WebFetch summary)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
- Page model: `read_page` and `find` return an accessibility tree whose elements carry tags such as `[ref_2]`, and Claude targets an element as `{"type":"ref","ref":"ref_2"}`. It falls back to viewport-pixel coordinates for canvas, video, virtualised lists and cross-origin iframes. Browser and computer toolsets can be declared together; `toolset_name` tells them apart. — [Browser use tool (WebFetch summary)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
- SDK helpers (beta): the Python and TypeScript client SDKs ship `BetaAbstractBrowserToolset20260801` and `BetaAbstractComputerToolset20260801` in `@anthropic-ai/sdk/helpers/beta/toolsets`. A driver subclasses one of them. The SDK checks a URL policy (`BetaURLContext`) and a file policy (`BetaNodeFilePolicy`), calls a confirm callback (`BetaConfirmContext`), and runs the loop through the tool runner. Browser Use, Browserbase (Stagehand), Daytona and E2B publish drivers. — [Browser and computer use with the SDK toolsets](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-sdk)

**Claude for Chrome / Claude in Chrome**
- Launched 2025-08-25 as a pilot for 1,000 Max users. It reached all Max subscribers in beta on 2025-11-24, then expanded to Pro, Team and Enterprise with a Claude Code integration on 2025-12-18. The page now says "Claude in Chrome is now generally available" but gives no GA date. — [Piloting Claude in Chrome (WebFetch summary)](https://claude.com/blog/claude-for-chrome)
- Pilot red team: 123 test cases across 29 attack scenarios. Attack success was 23.6% without mitigations and 11.2% with them, in autonomous mode. On a browser-specific challenge set (hidden DOM fields, injections in the URL or tab title), mitigations cut success from 35.7% to 0%. Mitigations include per-site permissions, confirmation before publishing, purchasing or sharing personal data, and blocked categories (financial services, adult content, piracy). — [Piloting Claude in Chrome](https://claude.com/blog/claude-for-chrome)
- Prompt-injection defenses post, 2025-11-24, attack success under an adaptive best-of-N attacker with 100 attempts per environment (model only / old safeguards / improved safeguards): Sonnet 4 13.8 / 10.7 / 2.0%; Sonnet 4.5 13.8 / 10.8 / 1.9%; Haiku 4.5 12.0 / 11.1 / 2.4%; Opus 4.5 8.0 / 7.6 / 1.4%. The values were read from a chart. The post states: "A 1% attack success rate … still represents meaningful risk." — [Mitigating prompt injection in browser use (WebFetch summary)](https://www.anthropic.com/research/prompt-injection-defenses)
- Secondary only and unconfirmed: a claim of 0–0.3% attack success "in the latest evaluations", traced to BigGo Finance. I could not find it in an Anthropic publication. — search summary, [aiunderstanding.org](https://aiunderstanding.org/news/anthropic-makes-claude-in-chrome-generally-available-with-autonomous-browser-actio)

**Non-browser alternatives (server tools)**
- At `@ai-sdk/anthropic@4.0.96` the Vercel provider exposes `webSearch_20260318`, with `webSearch_20260209` and `webSearch_20250305` kept as older versions, and `webFetch_20260318`. — local `docs/reference/vercel-ai-sdk/source/content/providers/01-ai-sdk-providers/05-anthropic.mdx:1544-1673`
- Anthropic positions web fetch and web search as "lighter server tools for reading known pages or finding sources", in contrast to the browser and computer toolsets. — [Browser use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)

### Inferences
- A harness that supports Opus 5.5 or Sonnet 5.5 on the Claude API must implement the toolset wire shape (one `tool_use` per action, `toolset_name`, ordered batches with halt text). A legacy `computer_20251124` loop that reads `input.action` will not work there.
- Because the browser toolset targets accessibility-tree refs, it is a different contract from pixel-only computer use, and it maps more naturally onto Playwright or CDP drivers.

### Gaps
- I found no Anthropic-published OSWorld or WebArena scores for the 5.x models in these sources. The computer-use page gives only qualitative comparisons, such as Sonnet 4.6 being "more mechanically precise at clicking" than Opus 4.6. A secondary claim that Opus 4.8 scores 83.4 on OSWorld-Verified (see the Google section) is unconfirmed.
- The token overhead of the browser toolset was in the part of the page WebFetch did not read.

## OpenAI: the GA `computer` tool, computer-use-preview, ChatGPT agent and Atlas

### Takeaway
As of November 2026, the Responses API tool is `{type: "computer"}`. It takes no display parameters and returns batched `actions[]` in each `computer_call`. The legacy `computer_use_preview` tool and its `computer-use-preview` model are shut down. For GPT-6 Astra, OpenAI now recommends a code-execution harness (the model writes Playwright code) over the computer tool. The client always executes the actions. Safety arrives as `pending_safety_checks`, which the client acknowledges.

### Cited Findings
- Migration table: model `computer-use-preview` → `gpt-6.1-sol`; tool `computer_use_preview` → `computer`; actions go from one `action` per `computer_call` to a batched `actions[]` array; `truncation: "auto"` is no longer needed. The preview tool also took `display_width`, `display_height` and `environment: "browser"`. — [Computer use integration, "Migration from computer-use-preview"](https://developers.openai.com/api/docs/guides/tools-computer-use-integration.md)
- `computer-use-preview` model page: "Status: Shut down". Default snapshot `computer-use-preview-2025-03-11`, 8,192-token context window, $3/$12 per 1M input/output tokens. — [computer-use-preview](https://developers.openai.com/api/docs/models/computer-use-preview.md)
- The current guide's examples use `gpt-6.2-sol` for the computer tool. "For GPT-6 Astra, we recommend code execution. The `computer` tool remains supported as an alternative." Code execution means a function tool that accepts a script, which the application runs against Playwright or PyAutoGUI in an isolated environment. — [Computer use guide](https://developers.openai.com/api/docs/guides/tools-computer-use.md)
- Action set: click, double_click, drag (`path` of points), keypress, move, scroll (`scrollX`, `scrollY`), type, wait and screenshot. Screenshots return as `computer_screenshot`, and `detail: "original"` is recommended so coordinates stay accurate. A downscaled screenshot means the client must map coordinates back. — [Computer use guide](https://developers.openai.com/api/docs/guides/tools-computer-use.md); local `docs/reference/vercel-ai-sdk/source/content/providers/01-ai-sdk-providers/03-openai.mdx:1105-1190`
- The OpenAI SDKs (`openai` Python 3.31.0, Node 7.33.0) now ship a `ComputerToolset` and a `BrowserToolset`, the latter exposing selected browser operations as function tools. The application supplies a driver. Partners named: Browserbase/Stagehand, Browser Use, Daytona and E2B Desktop. A separate "Agents API computer use" guide covers a browser hosted by OpenAI. — [Computer use guide](https://developers.openai.com/api/docs/guides/tools-computer-use.md)
- Safety: the API can attach `pending_safety_checks` (`id`, `code`, `message`) to a `computer_call`, and the client acknowledges them on the next output. The guide says to confirm purchases, data transmission ("Typing sensitive information into a form counts as transmission") and destructive changes; to treat screen content as untrusted; and to bound and verify each run. — [Computer use guide](https://developers.openai.com/api/docs/guides/tools-computer-use.md); local `docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/tools.mdx:104-127`
- Pricing: no per-tool figure is given. Requests bill input and output tokens, and screenshots bill as image input. — [Computer use guide](https://developers.openai.com/api/docs/guides/tools-computer-use.md)
- ChatGPT agent, launched July 2025, merges Operator's website interaction with deep research. Its tools are a visual browser, a text browser, a terminal and API access. It asks permission before consequential actions, and the user can take over. Reported WebArena score 65.4% (self-reported; seen through a search summary). — [Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/); [Neowin (secondary)](https://www.neowin.net/news/openai-introduces-chatgpt-agent-that-can-complete-tasks-using-its-own-computer/)
- Atlas "Agent Mode (Preview)" was available to Plus, Pro and Business users, with no system code execution, file system access or memory access (secondary: an arXiv paper). — [arXiv 2510.26298](https://arxiv.org/html/2510.26298v1)
- Secondary only: GPT-5.4 scored 75.0% on OSWorld-Verified (2026-03-05), against a human baseline of 72.4%; coverage of the Gemini 3.5 Flash launch cites GPT-5.5 at 78.7. I found no OpenAI primary source for either. — [dev.to (secondary)](https://dev.to/jahanzaibai/gpt-54-just-outperformed-humans-at-using-computers-here-is-what-that-means-for-your-business-b9h)

### Inferences
- OpenAI's guidance has moved from pixel actions toward "write browser code". A portable harness should treat a code-execution browser tool as a first-class alternative to a computer-action tool.

### Gaps
- I found no primary OpenAI OSWorld, WebArena or WebVoyager scores for the GA computer tool's models (`gpt-6.x`).
- The current list of `pending_safety_checks` codes is not in the guide text I read.
- No primary Atlas agent-mode documentation was read.

## Google: Gemini computer use and Project Mariner

### Takeaway
Computer use started in October 2025 as a separate preview model, `gemini-2.5-computer-use-preview-10-2025`, aimed at the browser. Since June 2026 it is a built-in `computer_use` tool in mainline models (Gemini 3.5 Flash and later, including the gemini-4 models) with browser, desktop and mobile environments. Coordinates are normalised to a 0–999 grid, which no other vendor uses. Safety arrives per action as `safety_decision`, and the client answers `require_confirmation` with `safety_acknowledgement`.

### Cited Findings
- Gemini 2.5 Computer Use model (2025-10-07): public preview in the Gemini API and Vertex AI, built on Gemini 2.5 Pro, optimised for browsers, promising on mobile, "not yet optimized for desktop OS-level control". An out-of-model per-step safety service checks each action. Chart alt text gives "70%+ accuracy, ∼225 sec latency" on Online-Mind2Web, run in Browserbase's harness. — [Google blog](https://blog.google/technology/google-deepmind/gemini-computer-use-model/)
- Secondary: VentureBeat's table gives Online-Mind2Web 65.7% for Gemini 2.5 against 61.0% for Claude Sonnet 4 and 44.3% for the OpenAI agent, with OSWorld not supported. — [VentureBeat (secondary)](https://venturebeat.com/ai/googles-ai-can-now-surf-the-web-for-you-click-on-buttons-and-fill-out-forms)
- Computer use in Gemini 3.5 Flash (2026-06-24): a built-in tool in the main Flash model, replacing the standalone 2.5 model, on the Gemini API and the Gemini Enterprise Agent Platform. It covers browser, mobile and desktop and uses adversarial training against prompt injection. Two optional enterprise safeguards: explicit confirmation for sensitive actions, and an automatic stop when an indirect prompt injection is detected. — [Google blog (WebFetch summary)](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-computer-use-gemini-3-5-flash/)
- Secondary and self-reported: OSWorld-Verified 78.4 for Gemini 3.5 Flash, against 65.1 for Gemini 3 Flash and 72.1 for GPT-5.4 mini. The blog shows the numbers only in a chart image. — [the-decoder (secondary)](https://the-decoder.com/google-bakes-computer-control-directly-into-gemini-3-5-flash-letting-the-model-see-and-operate-your-screen/)
- Current docs (ai.google.dev now redirects to aistudio.google.com). Models: gemini-4-carbon, gemini-4-argon, gemini-4-neon, gemini-4-hydrogen, gemini-3.8-flash, gemini-3.5-flash-lite and gemini-3-flash-preview. Tool shape: `{"type":"computer_use","environment":"browser"|"mobile"|"desktop","enable_prompt_injection_detection":true,"excluded_predefined_functions":[...],"disabled_safety_policies":[...]}`. — [Gemini computer use docs (WebFetch summary)](https://aistudio.google.com/docs/computer-use)
- Actions: browser has 20 (`click`, `double_click`, `triple_click`, `middle_click`, `right_click`, `mouse_down`, `mouse_up`, `move`, `type`, `drag_and_drop`, `wait`, `press_key`, `key_down`, `key_up`, `hotkey`, `take_screenshot`, `scroll`, `go_back`, `navigate`, `go_forward`). Desktop has 17, the browser set without navigation. Mobile has 10 (`open_app`, `list_apps`, `long_press` and others). x and y are integers from 0 to 999 ("normalized 1000x1000"). The client executes the actions, with Playwright in the examples. — [Gemini computer use docs (WebFetch summary)](https://aistudio.google.com/docs/computer-use)
- Legacy Gemini 2.x action names (`click_at`, `type_text_at`, `scroll_document`, `open_web_browser`, `search`, `wait_5_seconds`) differ from the Gemini 3.x names. ADK maps both and sends the legacy names to 1.x and 2.x models. — local `docs/reference/google-adk/source/adk-js/docs/guides/tools/computer_use/index.md`
- `safety_decision` has `explanation` and `decision` fields. On `require_confirmation` the client prompts the user and sends `safety_acknowledgement`; on a block it halts. — [Gemini computer use docs (WebFetch summary)](https://aistudio.google.com/docs/computer-use)

### Inferences
- Google now ships one model for chat and computer use. That differs from the 2025 split, and it means ADK's Gemini request must drop the system instruction only for models that still reject it (see the ADK finding below).

### Gaps
- No primary source was found for Project Mariner's current status or its relation to the API tool.
- Computer-use pricing was not on the docs page. It presumably follows normal token pricing, but this is unverified.

## Portability: what differs across the three vendor tools

### Takeaway
All three vendors make the client execute actions and return screenshots, but they differ on coordinate space, batching, action names, the safety handshake and whether a structured browser channel exists. A portable harness needs a thin per-provider adapter over one internal action model.

### Cited Findings
- Coordinates. Anthropic uses screenshot pixels and the client must downscale to the image limits. OpenAI uses environment pixels, with `detail: "original"` recommended. Gemini uses a normalised 0–999 grid. — [Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool); [OpenAI](https://developers.openai.com/api/docs/guides/tools-computer-use.md); [Google](https://aistudio.google.com/docs/computer-use)
- Batching. Anthropic sends several `tool_use` blocks with a halt-on-failure rule. OpenAI sends one `computer_call` with `actions[]` and one screenshot back. Gemini sends parallel `function_call`s, and every response must carry a screenshot; ADK serialises them per computer. — sources above; local `docs/reference/google-adk/source/adk-js/docs/guides/tools/computer_use/index.md`
- Action vocabulary. The same action has different names: Anthropic `left_click` / `key` / `left_click_drag`, OpenAI `click` / `keypress` / `drag`, Gemini `click` / `press_key` / `drag_and_drop`. Only Gemini's browser environment and Anthropic's browser toolset include `navigate`. Only Anthropic has `zoom`. — sources above
- Safety handshake. Anthropic runs classifiers server-side and reports nothing back for the client to acknowledge. OpenAI sends `pending_safety_checks` that the client acknowledges. Gemini sends `safety_decision`, which the client answers with `safety_acknowledgement`. — sources above
- Structured DOM channel. Anthropic offers it through the browser toolset's accessibility-tree refs. OpenAI offers it through `BrowserToolset` (function tools) or code execution. Gemini is screenshot and actions only. — sources above

### Inferences
- An internal action model needs: pixel coordinates in the screenshot frame, converted per provider (0–999 for Gemini); ordered batches with halt semantics; a provider-neutral safety-check record that is surfaced to an approval hook; and an optional DOM/ref channel. The OpenAI Agents SDK `Computer` interface and ADK's `BaseComputer` are the two existing abstractions to compare against.

### Gaps
- No cross-vendor benchmark under one harness was found. The published scores come from different harnesses and are mostly self-reported.

## Part B: browser and computer-use support in the SDKs we document

### Takeaway
As of November 2026, three of our SDKs wrap vendor computer-use tools natively: OpenAI Agents (`computerTool` + `Computer`), Google ADK (`ComputerUseToolset` + `BaseComputer`), and the Vercel AI SDK through provider tools. Cloudflare Agents is the only one that ships a browser runtime of its own (`agents/browser`, CDP on Browser Run). LangChain.js lags behind the vendors. The Claude Agent SDK, Pi and Copilot SDK have no computer-use tool and reach a browser through MCP, or in Claude's case the Chrome extension. Strands removed its browser tools in `strands-agents-tools` 0.9.0.

### Cited Findings
**Claude Agent SDK (pinned 0.3.327, also the latest as of 2026-11-18)**
- `BUILTIN_TOOL_NAMES` has no computer or browser tool, only `WebFetch`, `WebSearch` and `OfferChromeSetup`. `OfferChromeSetupInput` has one field, `reason` ("what the task needs the user's own browser for"). A managed setting, `allowClaudeInChromeWithManagedMcp`, refers to "the built-in Claude in Chrome MCP server". — npm tarball `@anthropic-ai/claude-agent-sdk@0.3.327`: `sdk.d.ts:232`, `sdk.d.ts:8059`, `sdk-tools.d.ts:2964`
- Claude Code's Chrome integration (`claude --chrome`, `/chrome`) drives the user's real Chrome or Edge through the Claude in Chrome extension (v1.0.36+), exposed as the `claude-in-chrome` MCP server. It requires a direct Anthropic plan and `/login`; API keys and `setup-token` keep it off, and it is unavailable on Bedrock, Google Cloud and Foundry, under ZDR and in WSL. A project's settings cannot turn it on (`CLAUDE_CODE_ENABLE_CFC` is ignored in project files). — [Use Claude Code with Chrome](https://code.claude.com/docs/en/chrome)
- To control native macOS apps, Claude Code has a separate computer-use feature. — [Use Claude Code with Chrome, "See also"](https://code.claude.com/docs/en/chrome)

**Pi (pinned 1.5.2; npm latest 1.5.2)**
- The Pi docs mirror has no built-in browser or computer tool. It supports MCP servers, exposed `direct` or through `codemode`, so Playwright MCP is the route. — local `docs/reference/pi/source/coding-agent/mcp.md`
- Cloudflare's `agents/browser/pi` exports `browserTool` for pi-durable. Screenshots come back as images, each conversation gets its own tab, and an interrupted call is not re-run. — local `docs/reference/cloudflare-agents/source/agents/docs/agents/browse-the-web.md`

**OpenAI Agents SDK JS (pinned 0.21.0; latest 0.22.0)**
- `computerTool()` takes a `Computer` instance, an initializer, or `{create, dispose}`. The `Computer` interface has optional `environment` and `dimensions`, plus `screenshot`, `click(x,y,button)`, `doubleClick`, `scroll(x,y,scrollX,scrollY)`, `type`, `wait`, `move`, `keypress(keys)` and `drag(path)`. — npm `@openai/agents-core@0.21.0` `dist/computer.d.ts:10-30`
- The SDK sends the GA `computer` tool when the request model is explicit (for example `gpt-5.4`). It keeps the `computer_use_preview` shape for stored prompts unless `modelSettings.toolChoice: 'computer'` is set. It executes batched `actions[]` in order and evaluates `needsApproval` per action. `onSafetyCheck` acknowledges or rejects `pending_safety_checks`; without it, the SDK proceeds and leaves the checks unacknowledged. — local `docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/tools.mdx:90-127`
- Version 0.22.0 has the same surface (`computerTool`, `Computer`, a `computer_use_preview` reference). Neither version has a `BrowserToolset`, which lives in the `openai` client SDK. — npm `@openai/agents-core@0.22.0`; [OpenAI guide](https://developers.openai.com/api/docs/guides/tools-computer-use.md)

**Vercel AI SDK (pinned `ai@7.0.162`, `@ai-sdk/anthropic@4.0.96`, `@ai-sdk/openai@4.0.108`; latest anthropic 4.0.106, openai 4.0.121)**
- `anthropic.tools.computer_20251124`, `computer_20250124` and `computerToolset_20260801`. The toolset maps every member back to one `execute({action, coordinate, text, region, …})` and serialises `toolset_name` on history. — local `05-anthropic.mdx:1402-1532`
- No `browserToolset` in `@ai-sdk/anthropic` 4.0.96 or 4.0.106. — npm tarball grep of `.d.ts`
- `openai.tools.computer` (GA): `execute({actions, pendingSafetyChecks, status})` returns `{output: {type: 'computer_screenshot', imageUrl, detail}, acknowledgedSafetyChecks}`, and `needsApproval` can gate on the safety checks. — local `03-openai.mdx:1105-1190`
- No computer-use tool in `@ai-sdk/google@4.0.122`. — npm tarball grep

**LangChain.js (pinned `@langchain/anthropic@1.6.0`, `@langchain/openai@1.8.0`; latest 1.6.5 and 1.8.4)**
- `@langchain/anthropic` exposes `tools.computer_20251124` and `tools.computer_20250124` only, even at 1.6.5, with no toolset. That means no computer use for Opus 5.5 or Sonnet 5.5 on the Claude API. — npm `@langchain/anthropic@1.6.0` `dist/tools/computer.d.ts:94,176`; 1.6.5 grep
- `@langchain/openai` `tools.computerUse()` still sends `type: "computer_use_preview"` with `displayWidth` and `environment`, at both 1.8.0 and 1.8.4, so it targets the shut-down preview path. — npm `@langchain/openai@1.8.4` `dist/tools/computerUse.js:218`
- `@langchain/community@1.1.29` has a `PlaywrightWebBaseLoader`, a document loader rather than an agent tool. I found no Playwright browser toolkit in the JS typings. — npm tarball grep

**Cloudflare Agents (pinned `agents@0.33.0`, also the latest)**
- `agents/browser` provides `Browser` + `browserRun(env.BROWSER)`, installed on the Durable Object's `Lifecycle` so it survives hibernation. `browserTool` has variants in `agents/browser/pi`, `agents/browser/tanstack-ai` and `agents/browser/ai-sdk`. The model writes code that sends raw CDP commands, "instead of a fixed set of actions (click, screenshot, navigate)". It needs a Worker Loader binding and supports only Chromium on Browser Run. Live View, session recording (`getBrowserRecording`) and an internal-host router are included. — local `docs/reference/cloudflare-agents/source/agents/docs/agents/browse-the-web.md`
- Deprecated: `createBrowserTools`, `createBrowserRuntime` and the Quick Action tools (`browser_markdown`, `browser_extract`, `browser_links`, `browser_scrape`); `@cloudflare/think` still documents `browser_execute`. — local `.../browse-the-web.md`; `docs/reference/cloudflare-agents/source/agents/docs/think/tools.md:354-402`
- `@cloudflare/playwright-mcp` is at 0.0.6 ("Cloudflare Playwright Tools for MCP"). — `npm view @cloudflare/playwright-mcp`

**Google ADK TypeScript (pinned 2.5.0, also the latest)**
- `ComputerUseToolset`, `ComputerUseTool` and `BaseComputer` were added in 2.5.0 (2026-11-12, #1166). All three are `@experimental`, and `ADK_DISABLE_COMPUTER_USE=true` turns the feature off. `BaseComputer` imports no browser library. — local `docs/reference/google-adk/source/adk-js/core/CHANGELOG.md:22`; `.../tools/computer_use/index.md`
- The toolset scales the 1000x1000 grid to `screenSize()` (configurable through `virtualScreenSize`) and maps `safety_decision: require_confirmation` onto the `requireConfirmation` flow, replying `safety_acknowledgement: 'true'`. It runs actions one at a time per computer, and the Gemini request drops the system instruction. `navigate` refuses non-http(s) URLs, localhost, `.internal` hosts, metadata hosts and private IPs unless `allowPrivateNetworkAccess` is set; the docs warn of a DNS-rebinding window. — local `.../tools/computer_use/index.md`

**GitHub Copilot SDK (pinned 1.0.31; latest 1.0.34)**
- The mirrored docs have no browser or Playwright tool; browser automation would come through `mcpServers`. — local `docs/reference/copilot-sdk/source/docs/features/mcp.md`
- GitHub's docs conflict on whether Playwright MCP is built into Copilot CLI. One page says it is configured by default only in the cloud coding-agent environment, and a docs issue reports it absent from CLI 1.0.5. Copilot coding agent got its own browser on 2025-07-02. — [GitHub changelog](https://github.blog/changelog/2025-07-02-copilot-coding-agent-now-has-its-own-web-browser/); [Copilot CLI add MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers); search summary
- `@playwright/mcp` is at 0.0.86 (Microsoft). — `npm view @playwright/mcp`

**Strands Agents (not one of our references; TS `@strands-agents/sdk@1.25.0`, Python `strands-agents-tools@0.9.0`)**
- The TS SDK's vended tools are bash, edit, file-editor, http-request, web-fetch, shell and others, with no browser tool. — npm `@strands-agents/sdk@1.25.0` `dist/src/vended-tools/`
- `browser` (`LocalChromiumBrowser`, `AgentCoreBrowser`) and `use_computer` started warning in v0.8.11 and error in v0.9.0, with "no replacement — drive Playwright directly, with `bedrock-agentcore`'s `BrowserClient` for AgentCore sessions". — [strands-agents/tools DEPRECATION.md](https://github.com/strands-agents/tools/blob/main/DEPRECATION.md)

### Inferences
- Only OpenAI Agents and ADK give us a reusable `Computer`-style seam. The Vercel provider tools are thin wire adapters, and Cloudflare's CDP code tool is a different paradigm, closer to OpenAI's code-execution recommendation. Our harness's portable browser seam should support both an action-based computer and a code-based browser.
- LangChain.js and Strands are poor bases for browser work as of November 2026. LangChain targets dead or legacy wire shapes, and Strands has removed its browser tools.

### Gaps
- `@langchain/community` Python has a Playwright toolkit; I did not confirm that no JS equivalent exists elsewhere (for example in `@langchain/mcp-adapters` docs).
- The openai-agents-js `examples/` folder at `v0.21.0` could not be listed: the GitHub API returned nothing in this session, and gh access is not enabled. So the Playwright computer example's path is unconfirmed.
- I did not check whether the Claude Agent SDK can start the `claude-in-chrome` MCP server headlessly. The Chrome docs require `/login` with a claude.ai plan, which suggests SDK use with an API key is excluded.

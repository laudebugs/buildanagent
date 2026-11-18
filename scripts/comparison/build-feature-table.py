import re

# One letter per SDK. F = Cloudflare Agents, G = Google ADK, H = GitHub Copilot SDK.
SDK = {
    "C": "claude-agent-sdk",
    "P": "pi",
    "O": "openai-agents-sdk",
    "V": "vercel-ai-sdk",
    "L": "langchain",
    "F": "cloudflare-agents",
    "G": "google-adk",
    "H": "copilot-sdk",
}
LETTERS = "".join(SDK)
# Sections of docs/comparison/typescript-gaps.md, keyed by the start of their "## " heading.
GAPS = {
    "summary": "Summary:",
    "adk": "Google ADK:",
    "openai": "OpenAI Agents SDK:",
    "langchain": "LangChain:",
    "copilot": "GitHub Copilot SDK:",
    "claude": "Claude Agent SDK:",
}


def slug(h):
    h = h.strip().lower()
    h = re.sub(r"[^\w\- ]", "", h)
    return h.replace(" ", "-")


heads = {}
for k, d in SDK.items():
    for line in open(f"docs/reference/{d}/guide.md"):
        m = re.match(r"## (\d+)\. (.*)", line)
        if m:
            heads[(k, m.group(1))] = slug(m.group(1) + ". " + m.group(2))

gap_heads = {}
for line in open("docs/comparison/typescript-gaps.md"):
    m = re.match(r"## (.*)", line)
    if m:
        for key, prefix in GAPS.items():
            if m.group(1).startswith(prefix):
                gap_heads[key] = slug(m.group(1))


def link(tok):
    # tokens: C§7 (guide section), Cfc (fact-check), Tadk (TypeScript gap report section)
    if tok.startswith("T"):
        return f"[gaps](typescript-gaps.md#{gap_heads[tok[1:]]})"
    k = tok[0]
    rest = tok[1:]
    d = SDK[k]
    if rest.startswith("§"):
        n = rest[1:]
        return f"[§{n}](../reference/{d}/guide.md#{heads[(k, n)]})"
    if rest == "fc":
        return f"[fact-check](../reference/{d}/fact-check.md)"
    raise ValueError(tok)


src = open("scripts/comparison/feature-table.src.md").read()
token = rf"\{{([{LETTERS}](?:§\d+|fc)|T(?:{'|'.join(GAPS)}))\}}"
out = re.sub(token, lambda m: link(m.group(1)), src)
open("docs/comparison/feature-table.md", "w").write(out)
missing = re.findall(rf"\{{[{LETTERS}T][^}}]*\}}", out)
print("unresolved:", missing)

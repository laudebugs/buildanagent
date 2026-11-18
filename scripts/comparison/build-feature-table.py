import re
SDK = {"C":"claude-agent-sdk","P":"pi","O":"openai-agents-sdk","V":"vercel-ai-sdk","L":"langchain"}
def slug(h):
    h=h.strip().lower()
    h=re.sub(r"[^\w\- ]","",h)
    return h.replace(" ","-")
heads={}
for k,d in SDK.items():
    for line in open(f"docs/reference/{d}/guide.md"):
        m=re.match(r"## (\d+)\. (.*)",line)
        if m: heads[(k,m.group(1))]=slug(m.group(1)+". "+m.group(2))
def link(tok):
    # tokens: C§7, Cfc (fact-check), Cex07 (example)
    k=tok[0]; rest=tok[1:]
    d=SDK[k]
    if rest.startswith("§"):
        n=rest[1:]; return f"[§{n}](../reference/{d}/guide.md#{heads[(k,n)]})"
    if rest=="fc": return f"[fact-check](../reference/{d}/fact-check.md)"
    raise ValueError(tok)
src=open("scripts/comparison/feature-table.src.md").read()
out=re.sub(r"\{([CPOVL](?:§\d+|fc))\}",lambda m:link(m.group(1)),src)
assert "{" not in re.sub(r"`[^`]*`","",out).replace("{ ","").replace(" }","") or True
open("docs/comparison/feature-table.md","w").write(out)
missing=re.findall(r"\{[CPOVL][^}]*\}",out)
print("unresolved:",missing)

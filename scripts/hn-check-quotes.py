# Check that every attributed quote in docs/research/practitioners/notes/ appears in the cited HN comment.
# Needs the gitignored raw corpus (node scripts/hn-corpus.mjs). Usage: python3 scripts/hn-check-quotes.py
import json,os,re,html,glob,sys
RAW='docs/research/practitioners/.raw'
idx={}
def clean(t): t=html.unescape(re.sub(r'<[^>]+>',' ',t or '')); return re.sub(r'\s+',' ',re.sub(r"[“”\"‘’`]","'",t)).lower()
def walk(n):
    idx[str(n['id'])]=clean((n.get('title') or '')+' '+(n.get('text') or ''))
    for c in n.get('children') or []: walk(c)
for f in os.listdir(RAW): walk(json.load(open(os.path.join(RAW,f))))
tot=ok=0; bad=[]
pat=re.compile(r'["“]([^"”\n]{6,300})["”]\s*(?:\)|,|\.)?\s*(?:—|-|–)?\s*[\w.\-]*\s*,?\s*\(?\[HN\]\(https://news\.ycombinator\.com/item\?id=(\d+)\)')
for p in sorted(glob.glob('docs/research/practitioners/notes/*.md')):
    for m in pat.finditer(open(p).read()):
        q,cid=m.group(1),m.group(2); tot+=1
        frags=[f.strip(" '.,;:") for f in re.split(r'\s*(?:…|\.\.\.|\[…\])\s*',clean(q)) if len(f.strip())>3]
        if cid in idx and all(f in idx[cid] for f in frags): ok+=1
        else: bad.append((os.path.basename(p),cid,q[:100], cid in idx))
print(f"attributed quotes {tot}, verified {ok}, unverified {len(bad)}")
for b in bad: print(b)

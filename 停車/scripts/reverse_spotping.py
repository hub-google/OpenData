#!/usr/bin/env python3
import re, subprocess, html
from pathlib import Path
from urllib.parse import urljoin

base="https://spotping.autoit.studio/"
p=subprocess.run(["curl","-4","-k","-L","--compressed","--max-time","30","-A","Mozilla/5.0","-sS",base],
                 stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=35)
page=p.stdout
sources=[("HTML",page)]
for src in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']',page,re.I):
    u=urljoin(base,html.unescape(src))
    try:
        q=subprocess.run(["curl","-4","-k","-L","--compressed","--max-time","20","-A","Mozilla/5.0","-sS",u],
                         stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=25)
        sources.append((u,q.stdout))
    except Exception:
        pass
patterns=[
    r'https?://[^"\'<>\s)]+',
    r'fetch\([^)]{0,1000}',
    r'axios\.(?:get|post)\([^)]{0,1000}',
    r'["\']([^"\']*(?:api|parking|park|availability|available|surplus|tdx|transportdata|json)[^"\']*)["\']'
]
hits=[]
for src,txt in sources:
    for pat in patterns:
        for m in re.findall(pat,txt,re.I):
            val=m if isinstance(m,str) else "".join(m)
            val=html.unescape(val)
            if len(val)>1500: continue
            low=val.lower()
            if any(k in low for k in ["parking","park","api","availability","available","surplus","tdx","transportdata","json"]):
                pair=(src,val)
                if pair not in hits: hits.append(pair)
out=Path("停車/SpotPing來源反查.md")
lines=["# SpotPing 資料來源反查","",f"- curl rc: {p.returncode}",f"- homepage bytes: {len(page.encode())}","",
       "## Script sources",""]
for src,_ in sources: lines.append(f"- {src}")
lines += ["","## API / endpoint hints",""]
for src,val in hits[:500]: lines.append(f"- {val}  ← {src}")
out.write_text("\n".join(lines),encoding="utf-8")
print(out.read_text(encoding="utf-8"))

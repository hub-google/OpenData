import asyncio, json, os, re, urllib.parse, time
from pathlib import Path
from playwright.async_api import async_playwright

TARGET=os.environ.get("TARGET_URL")
MAX_COMMENTS=int(os.environ.get("MAX_COMMENTS","5000"))
OUT=Path("fb_diag"); OUT.mkdir(exist_ok=True)
ALL_TOKEN="RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1"
NEWEST_TOKEN="REVERSE_CHRONOLOGICAL_UNFILTERED_INTENT_V1"

def normalize(n):
    fb=n.get("feedback") or {}
    author=n.get("author") or {}
    tr=fb.get("top_reactions") or {}
    reaction_total=sum((e.get("reaction_count") or 0) for e in tr.get("edges",[]) if isinstance(e,dict))
    replies=fb.get("replies_fields") or {}
    return {
      "comment_id":n.get("legacy_fbid"),
      "node_id":n.get("id"),
      "author_id":author.get("id"),
      "author_name":author.get("name"),
      "author_gender":author.get("gender"),
      "created_time":n.get("created_time"),
      "text":((n.get("body") or {}).get("text") or ""),
      "depth":n.get("depth"),
      "reply_count":replies.get("total_count"),
      "reaction_count":reaction_total,
      "url":fb.get("url"),
    }

def get_comments(o):
    try: return o["data"]["node"]["comment_rendering_instance_for_feed_location"]["comments"]
    except Exception: return None

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(channel="chrome",headless=True,args=["--disable-blink-features=AutomationControlled"])
    ctx=await browser.new_context(locale="en-US",viewport={"width":1440,"height":1800},
      user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
    page=await ctx.new_page(); captured=[]

    def on_request(req):
      if "facebook.com/api/graphql" in req.url and req.method=="POST":
        pd=req.post_data or ""
        if "CommentsListComponentsPaginationQuery" in pd:
          captured.append({"post_data":pd,"headers":req.headers})
    page.on("request",on_request)

    await page.goto(TARGET,wait_until="domcontentloaded",timeout=120000)
    try: await page.get_by_text("View more comments",exact=True).wait_for(state="attached",timeout=12000)
    except: pass
    await page.wait_for_timeout(500)

    # Remove only the logged-out upsell, not the post dialog.
    ds=page.locator('[role="dialog"]'); n=await ds.count()
    for i in reversed(range(n)):
      try:
        t=(await ds.nth(i).inner_text(timeout=500))[:1200]
        if ("See more from" in t and ("Log in" in t or "Create new account" in t)) or "Log into Facebook" in t:
          await ds.nth(i).evaluate("(el)=>el.remove()")
      except: pass
    await page.evaluate("()=>{document.body.style.overflow='auto';document.documentElement.style.overflow='auto'}")

    vm=page.get_by_text("View more comments",exact=True)
    if not await vm.count(): raise RuntimeError("No View more comments control")
    el=vm.last.locator("xpath=ancestor::*[@role='button'][1]")
    await el.evaluate("(el)=>el.click()")
    for _ in range(30):
      if captured: break
      await page.wait_for_timeout(200)
    if not captured: raise RuntimeError("Could not capture pagination request")

    template=captured[0]
    pairs=urllib.parse.parse_qsl(template["post_data"],keep_blank_values=True)
    base={k:v for k,v in pairs}
    headers={}
    for k,v in template["headers"].items():
      lk=k.lower()
      if lk in ["x-fb-friendly-name","x-fb-lsd","x-asbd-id","accept","accept-language","origin","referer"]:
        headers[k]=v

    async def gql(intent,cursor=None):
      form=dict(base)
      vars=json.loads(form["variables"])
      vars["commentsIntentToken"]=intent
      vars["commentsAfterCursor"]=cursor
      vars["commentsBeforeCursor"]=None
      vars["commentsBeforeCount"]=None
      form["variables"]=json.dumps(vars,separators=(",",":"))
      resp=await ctx.request.post("https://www.facebook.com/api/graphql/",form=form,headers=headers,timeout=60000)
      txt=await resp.text()
      try:
        o=json.loads(txt)
      except Exception:
        # tolerate anti-JSON prefix or multipart-ish single JSON line
        m=re.search(r'\{.*',txt,re.S)
        if not m: raise RuntimeError(f"Non-JSON GraphQL response {resp.status}: {txt[:500]}")
        o=json.loads(m.group(0))
      return resp.status,o,txt

    # Verify which sort token truly returns an unfiltered connection.
    probes={}
    for name,token in [("most_relevant",None),("all_comments",ALL_TOKEN),("newest",NEWEST_TOKEN)]:
      st,o,txt=await gql(token,None)
      c=get_comments(o)
      probes[name]={
        "status":st,
        "ok":bool(c),
        "edge_count":len(c.get("edges",[])) if c else 0,
        "count":c.get("count") if c else None,
        "total_count":c.get("total_count") if c else None,
        "page_info":c.get("page_info") if c else None,
        "error":o.get("errors") if isinstance(o,dict) else None,
      }
      (OUT/f"probe_{name}.json").write_text(txt,encoding="utf-8")

    # Prefer All comments; it explicitly includes potential spam in Facebook's own UI.
    intent=ALL_TOKEN if probes["all_comments"]["ok"] else NEWEST_TOKEN if probes["newest"]["ok"] else None
    sort_name="all_comments" if intent==ALL_TOKEN else "newest" if intent==NEWEST_TOKEN else "most_relevant"

    comments=[]; seen=set(); pages=[]; cursor=None; page_no=0
    while len(comments)<MAX_COMMENTS:
      page_no+=1
      st,o,txt=await gql(intent,cursor)
      c=get_comments(o)
      if not c:
        pages.append({"page":page_no,"status":st,"error":o.get("errors") if isinstance(o,dict) else "no comments"})
        break
      edges=c.get("edges") or []
      added=0
      for e in edges:
        n=e.get("node") or {}
        row=normalize(n)
        key=row["comment_id"] or row["node_id"]
        if key and key not in seen:
          seen.add(key); comments.append(row); added+=1
          if len(comments)>=MAX_COMMENTS: break
      pi=c.get("page_info") or {}
      next_cursor=pi.get("end_cursor")
      pages.append({"page":page_no,"status":st,"edges":len(edges),"added":added,"n_total":len(comments),
                    "connection_count":c.get("count"),"total_count":c.get("total_count"),
                    "has_next_page":pi.get("has_next_page"),"cursor_changed":next_cursor!=cursor})
      if page_no%25==0:
        print(json.dumps({"page":page_no,"comments":len(comments),"last":pages[-1]},ensure_ascii=False),flush=True)
      if not pi.get("has_next_page") or not next_cursor or next_cursor==cursor or added==0: break
      cursor=next_cursor
      await asyncio.sleep(0.12)

    (OUT/"comments.jsonl").write_text("\n".join(json.dumps(x,ensure_ascii=False) for x in comments)+"\n",encoding="utf-8")
    (OUT/"pages.json").write_text(json.dumps(pages,ensure_ascii=False,indent=2),encoding="utf-8")
    summary={"sort":sort_name,"probes":probes,"comments":len(comments),"unique_comment_ids":len(seen),"pages":len(pages),"last_page":pages[-1] if pages else None}
    (OUT/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    await browser.close()

asyncio.run(main())

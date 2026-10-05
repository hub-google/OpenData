import asyncio,json,os,re,urllib.parse
from pathlib import Path
from playwright.async_api import async_playwright

TARGET=os.environ.get("TARGET_URL")
TARGET_N=int(os.environ.get("TARGET_N","5000"))
OUT=Path("fb_diag");OUT.mkdir(exist_ok=True)
ALL_TOKEN="RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1"
NEWEST_TOKEN="REVERSE_CHRONOLOGICAL_UNFILTERED_INTENT_V1"

def comments_obj(o):
    try:return o["data"]["node"]["comment_rendering_instance_for_feed_location"]["comments"]
    except:return None

def norm(n):
    fb=n.get("feedback") or {}; au=n.get("author") or {}; reps=fb.get("replies_fields") or {}
    rx=sum((e.get("reaction_count") or 0) for e in ((fb.get("top_reactions") or {}).get("edges") or []) if isinstance(e,dict))
    return {"comment_id":n.get("legacy_fbid"),"node_id":n.get("id"),"author_id":au.get("id"),"author_name":au.get("name"),
            "created_time":n.get("created_time"),"text":((n.get("body") or {}).get("text") or ""),
            "depth":n.get("depth"),"reply_count":reps.get("total_count"),"reaction_count":rx,"url":fb.get("url")}

async def remove_login(page):
    ds=page.locator('[role="dialog"]')
    for i in reversed(range(await ds.count())):
        try:
            t=(await ds.nth(i).inner_text(timeout=300))[:1000]
            if ("See more from" in t and ("Log in" in t or "Create new account" in t)) or "Log into Facebook" in t:
                await ds.nth(i).evaluate("(el)=>el.remove()")
        except:pass
    try: await page.evaluate("()=>{document.body.style.overflow='auto';document.documentElement.style.overflow='auto'}")
    except: pass

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(channel="chrome",headless=True,args=["--disable-blink-features=AutomationControlled"])
    captured=[]
    page=None;ctx=None
    # Logged-out Facebook rendering is somewhat nondeterministic by runner. Retry fresh contexts.
    for attempt in range(1,7):
      if ctx: await ctx.close()
      ctx=await browser.new_context(locale="en-US",viewport={"width":1440,"height":1800},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
      page=await ctx.new_page(); captured=[]
      def onreq(req):
        if "facebook.com/api/graphql" in req.url and req.method=="POST" and "CommentsListComponentsPaginationQuery" in (req.post_data or ""):
          captured.append({"post_data":req.post_data,"headers":req.headers})
      page.on("request",onreq)
      try:
        await page.goto(TARGET,wait_until="domcontentloaded",timeout=90000)
        await page.wait_for_timeout(1300)
        await remove_login(page)
        vm=page.get_by_text("View more comments",exact=True)
        if await vm.count():
          b=vm.last.locator("xpath=ancestor::*[@role='button'][1]")
          await b.evaluate("(el)=>el.click()")
          for _ in range(35):
            if captured: break
            await page.wait_for_timeout(180)
        if captured:
          print(json.dumps({"bootstrap_attempt":attempt,"captured":len(captured)}),flush=True)
          break
      except Exception as e:
        print(json.dumps({"bootstrap_attempt":attempt,"error":str(e)[:200]}),flush=True)
    if not captured: raise RuntimeError("Could not bootstrap a natural Facebook comment pagination request")

    cap=captured[0]
    base=dict(urllib.parse.parse_qsl(cap["post_data"],keep_blank_values=True))
    natural_vars=json.loads(base["variables"])
    start_cursor=natural_vars.get("commentsAfterCursor")

    # Only headers JavaScript is allowed to set; browser supplies Origin/Referer/Cookies/fetch metadata.
    js_headers={
      "content-type":"application/x-www-form-urlencoded",
      "x-fb-friendly-name":"CommentsListComponentsPaginationQuery",
    }
    for k in ["x-fb-lsd","x-asbd-id"]:
      if cap["headers"].get(k): js_headers[k]=cap["headers"][k]

    async def inpage_fetch(cursor,intent="KEEP"):
      form=dict(base)
      v=json.loads(form["variables"])
      v["commentsAfterCursor"]=cursor
      v["commentsAfterCount"]=-1
      v["commentsBeforeCursor"]=None
      v["commentsBeforeCount"]=None
      v["feedLocation"]="POST_PERMALINK_DIALOG"
      if intent!="KEEP": v["commentsIntentToken"]=intent
      form["variables"]=json.dumps(v,separators=(",",":"))
      body=urllib.parse.urlencode(form)
      ret=await page.evaluate("""async ({body,headers})=>{
        const r=await fetch('/api/graphql/',{method:'POST',headers,body,credentials:'include'});
        return {status:r.status,text:await r.text()};
      }""",{"body":body,"headers":js_headers})
      txt=ret["text"]
      o=None
      # Natural response is normally one JSON object; tolerate FB anti-JSON prefix.
      cand=txt
      if cand.startswith("for (;;);"): cand=cand[len("for (;;);"):]
      try:o=json.loads(cand)
      except:
        for line in txt.splitlines():
          line=line.strip()
          if line.startswith("for (;;);"): line=line[len("for (;;);"):]
          try:
            q=json.loads(line)
            if comments_obj(q):o=q;break
          except:pass
      return ret["status"],o,txt

    # Test replay of the *naturally valid next-page cursor*, not null.
    probes={}
    chosen="KEEP";chosen_name="most_relevant"
    probe_cursor_by_name={"most_relevant":start_cursor,"all_comments":None,"newest":None}
    for name,tok in [("most_relevant","KEEP"),("all_comments",ALL_TOKEN),("newest",NEWEST_TOKEN)]:
      st,o,txt=await inpage_fetch(probe_cursor_by_name[name],tok)
      c=comments_obj(o) if o else None
      probes[name]={"status":st,"ok":bool(c),"edges":len(c.get("edges",[])) if c else 0,
                    "page_info":c.get("page_info") if c else None,"head":txt[:160]}
      (OUT/f"probe_{name}.txt").write_text(txt,encoding="utf-8")
      if name=="newest" and c:
        chosen=NEWEST_TOKEN;chosen_name=name
      elif name=="all_comments" and c and chosen_name=="most_relevant":
        chosen=ALL_TOKEN;chosen_name=name

    if not any(x["ok"] for x in probes.values()):
      raise RuntimeError("In-page GraphQL fetch still rejected: "+json.dumps(probes,ensure_ascii=False))

    rows={};pages=[];cursor=(None if chosen_name in ["newest","all_comments"] else start_cursor)
    # Include response for first valid fetch, then continue cursor chain.
    for page_no in range(1,10000):
      st,o,txt=await inpage_fetch(cursor,chosen)
      c=comments_obj(o) if o else None
      if not c:
        pages.append({"page":page_no,"status":st,"error_head":txt[:300]});break
      edges=c.get("edges") or [];added=0
      for e in edges:
        r=norm(e.get("node") or {});cid=r.get("comment_id")
        if cid and cid not in rows:
          rows[cid]=r;added+=1
          if len(rows)>=TARGET_N:break
      pi=c.get("page_info") or {};nxt=pi.get("end_cursor")
      pages.append({"page":page_no,"edges":len(edges),"added":added,"n":len(rows),
                    "has_next":pi.get("has_next_page"),"cursor_changed":nxt!=cursor})
      if page_no%25==0:print(json.dumps(pages[-1],ensure_ascii=False),flush=True)
      if len(rows)>=TARGET_N or not pi.get("has_next_page") or not nxt or nxt==cursor or added==0:break
      cursor=nxt
      await asyncio.sleep(0.10)

    (OUT/"comments.jsonl").write_text("\n".join(json.dumps(x,ensure_ascii=False) for x in rows.values())+"\n",encoding="utf-8")
    (OUT/"pages.json").write_text(json.dumps(pages,ensure_ascii=False,indent=2),encoding="utf-8")
    summary={"bootstrap_cursor_present":bool(start_cursor),"chosen_sort":chosen_name,"probes":probes,
             "comments":len(rows),"pages":len(pages),"last":pages[-1] if pages else None}
    (OUT/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    await browser.close()

asyncio.run(main())

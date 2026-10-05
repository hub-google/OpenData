import asyncio,json,os,re,urllib.parse,random
from pathlib import Path
from playwright.async_api import async_playwright

TARGET=os.environ.get("TARGET_URL")
MAX_COMMENTS=int(os.environ.get("MAX_COMMENTS","5000"))
OUT=Path("fb_diag"); OUT.mkdir(exist_ok=True)
DROP={"host","content-length","connection","accept-encoding","cookie"}
ALL_TOKEN="RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1"
NEWEST_TOKEN="REVERSE_CHRONOLOGICAL_UNFILTERED_INTENT_V1"

def comments_obj(o):
 try:return o["data"]["node"]["comment_rendering_instance_for_feed_location"]["comments"]
 except:return None

def norm(n):
 fb=n.get("feedback") or {}; au=n.get("author") or {}; reps=fb.get("replies_fields") or {}
 rx=sum((e.get("reaction_count") or 0) for e in ((fb.get("top_reactions") or {}).get("edges") or []) if isinstance(e,dict))
 return {"comment_id":n.get("legacy_fbid"),"author_id":au.get("id"),"author_name":au.get("name"),
 "created_time":n.get("created_time"),"text":((n.get("body") or {}).get("text") or ""),
 "reply_count":reps.get("total_count"),"reaction_count":rx,"url":fb.get("url")}

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(channel="chrome",headless=True,args=["--disable-blink-features=AutomationControlled"])
  ctx=await browser.new_context(locale="en-US",viewport={"width":1440,"height":1800},
   user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
  page=await ctx.new_page(); captured=[]
  def onreq(req):
   if "facebook.com/api/graphql" in req.url and req.method=="POST" and "CommentsListComponentsPaginationQuery" in (req.post_data or ""):
    captured.append({"post_data":req.post_data,"headers":req.headers})
  page.on("request",onreq)
  await page.goto(TARGET,wait_until="domcontentloaded",timeout=120000)
  try:await page.get_by_text("View more comments",exact=True).wait_for(state="attached",timeout=12000)
  except:pass
  await page.wait_for_timeout(400)
  # Remove ONLY login upsell.
  ds=page.locator('[role="dialog"]')
  for i in reversed(range(await ds.count())):
   try:
    t=(await ds.nth(i).inner_text(timeout=400))[:1000]
    if ("See more from" in t and ("Log in" in t or "Create new account" in t)) or "Log into Facebook" in t:
     await ds.nth(i).evaluate("(el)=>el.remove()")
   except:pass
  await page.evaluate("()=>{document.body.style.overflow='auto';document.documentElement.style.overflow='auto'}")
  vm=page.get_by_text("View more comments",exact=True)
  if not await vm.count():raise RuntimeError("No public View more comments")
  btn=vm.last.locator("xpath=ancestor::*[@role='button'][1]")
  await btn.evaluate("(el)=>el.click()")
  for _ in range(40):
   if captured:break
   await page.wait_for_timeout(150)
  if not captured:raise RuntimeError("No CLCPQ captured")

  cap=captured[0]
  base=dict(urllib.parse.parse_qsl(cap["post_data"],keep_blank_values=True))
  headers={k:v for k,v in cap["headers"].items() if not k.startswith(":") and k.lower() not in DROP}
  headers["Accept-Encoding"]="gzip, deflate"

  async def replay(cursor=None,intent_marker="KEEP"):
   form=dict(base)
   vars=json.loads(form.get("variables","{}"))
   vars["commentsAfterCursor"]=cursor
   vars["commentsAfterCount"]=-1
   vars["feedLocation"]="POST_PERMALINK_DIALOG"
   if intent_marker!="KEEP":
    vars["commentsIntentToken"]=intent_marker
   form["variables"]=json.dumps(vars,separators=(",",":"))
   body=urllib.parse.urlencode(form)
   r=await page.request.post("https://www.facebook.com/api/graphql/",headers=headers,data=body,timeout=60000)
   txt=await r.text()
   try:o=json.loads(txt)
   except:
    o={}
    for line in txt.splitlines():
     try:
      x=json.loads(line)
      if comments_obj(x):o=x;break
     except:pass
   return r.status,o,txt

  # Exact-replay probes. KEEP preserves FB's naturally captured variables.
  probes={}
  chosen="KEEP"; chosen_name="most_relevant"
  for name,tok in [("most_relevant","KEEP"),("all_comments",ALL_TOKEN),("newest",NEWEST_TOKEN)]:
   st,o,txt=await replay(None,tok); c=comments_obj(o)
   probes[name]={"status":st,"ok":bool(c),"edges":len(c.get("edges",[])) if c else 0,
                 "count":c.get("count") if c else None,"total_count":c.get("total_count") if c else None,
                 "has_next":(c.get("page_info") or {}).get("has_next_page") if c else None}
   (OUT/f"probe_{name}.json").write_text(txt,encoding="utf-8")
   if name=="all_comments" and c:chosen=ALL_TOKEN;chosen_name=name
   elif name=="newest" and c and chosen_name=="most_relevant":chosen=NEWEST_TOKEN;chosen_name=name

  comments=[];seen=set();pages=[];cursor=None
  for page_no in range(1,10000):
   st,o,txt=await replay(cursor,chosen); c=comments_obj(o)
   if not c:
    pages.append({"page":page_no,"status":st,"no_comments":True,"body_head":txt[:300]});break
   edges=c.get("edges") or [];added=0
   for e in edges:
    row=norm(e.get("node") or {}); key=row["comment_id"]
    if key and key not in seen:
     seen.add(key);comments.append(row);added+=1
     if len(comments)>=MAX_COMMENTS:break
   pi=c.get("page_info") or {};nxt=pi.get("end_cursor")
   pages.append({"page":page_no,"edges":len(edges),"added":added,"n":len(comments),
                 "count":c.get("count"),"total_count":c.get("total_count"),
                 "has_next":pi.get("has_next_page"),"cursor_changed":nxt!=cursor})
   if page_no%25==0:print(json.dumps(pages[-1],ensure_ascii=False),flush=True)
   if len(comments)>=MAX_COMMENTS or not pi.get("has_next_page") or not nxt or nxt==cursor or added==0:break
   cursor=nxt
   await asyncio.sleep(0.10)

  (OUT/"comments.jsonl").write_text("\n".join(json.dumps(x,ensure_ascii=False) for x in comments)+"\n",encoding="utf-8")
  (OUT/"pages.json").write_text(json.dumps(pages,ensure_ascii=False,indent=2),encoding="utf-8")
  summary={"chosen_sort":chosen_name,"probes":probes,"comments":len(comments),"unique_ids":len(seen),"pages":len(pages),"last":pages[-1] if pages else None}
  (OUT/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
  print(json.dumps(summary,ensure_ascii=False),flush=True)
  await browser.close()
asyncio.run(main())

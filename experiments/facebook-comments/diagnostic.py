import asyncio,json,os,re
from pathlib import Path
from playwright.async_api import async_playwright
TARGET=os.environ.get("TARGET_URL")
TARGET_N=int(os.environ.get("TARGET_N","1000"))
OUT=Path("fb_diag");OUT.mkdir(exist_ok=True)

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
  page=await ctx.new_page(); rows={}; net_stats={"requests":0,"responses":0,"parse_errors":0}; tasks=[]

  async def handle(resp):
   if "facebook.com/api/graphql" not in resp.url:return
   req=resp.request; pd=req.post_data or ""
   if "CommentsListComponentsPaginationQuery" not in pd:return
   net_stats["responses"]+=1
   try:
    txt=await resp.text(); o=json.loads(txt)
    c=o["data"]["node"]["comment_rendering_instance_for_feed_location"]["comments"]
    for e in c.get("edges") or []:
     r=norm(e.get("node") or {}); cid=r.get("comment_id")
     if cid:rows[cid]=r
   except Exception as e:
    net_stats["parse_errors"]+=1

  def onresp(resp):
   tasks.append(asyncio.create_task(handle(resp)))
  def onreq(req):
   if "facebook.com/api/graphql" in req.url and "CommentsListComponentsPaginationQuery" in (req.post_data or ""):
    net_stats["requests"]+=1
  page.on("request",onreq); page.on("response",onresp)

  await page.goto(TARGET,wait_until="domcontentloaded",timeout=120000)
  try:await page.get_by_text("View more comments",exact=True).wait_for(state="attached",timeout=12000)
  except:pass
  await page.wait_for_timeout(800)

  async def remove_login():
   ds=page.locator('[role="dialog"]')
   for i in reversed(range(await ds.count())):
    try:
     t=(await ds.nth(i).inner_text(timeout=300))[:900]
     if ("See more from" in t and ("Log in" in t or "Create new account" in t)) or "Log into Facebook" in t:
      await ds.nth(i).evaluate("(el)=>el.remove()")
    except:pass
   await page.evaluate("()=>{document.body.style.overflow='auto';document.documentElement.style.overflow='auto'}")

  await remove_login()
  no_progress=0; last=0; steps=[]
  for i in range(600):
   if len(rows)>=TARGET_N:break
   await remove_login()

   # Move the actual scrollable comment pane to its bottom.
   scrollinfo=await page.evaluate("""() => {
     const arts=[...document.querySelectorAll('[role="article"]')].filter(e=>e.offsetWidth>0 && e.offsetHeight>0);
     let e=arts.length?arts[arts.length-1]:null;
     while(e){
       const s=getComputedStyle(e);
       if((s.overflowY==='auto'||s.overflowY==='scroll') && e.scrollHeight>e.clientHeight+50){
         e.scrollTop=e.scrollHeight; e.dispatchEvent(new Event('scroll',{bubbles:true}));
         return {kind:'container',sh:e.scrollHeight,ch:e.clientHeight,top:e.scrollTop};
       }
       e=e.parentElement;
     }
     window.scrollTo(0,document.documentElement.scrollHeight);
     return {kind:'window',sh:document.documentElement.scrollHeight,ch:innerHeight,top:scrollY};
   }""")

   # Click only a visible load-more control.
   clicked=False
   vm=page.get_by_text("View more comments",exact=True)
   cnt=await vm.count()
   for k in reversed(range(cnt)):
    try:
     if await vm.nth(k).is_visible():
      b=vm.nth(k).locator("xpath=ancestor::*[@role='button'][1]")
      await b.scroll_into_view_if_needed()
      await b.evaluate("(el)=>el.click()")
      clicked=True;break
    except:pass

   await page.wait_for_timeout(900)
   # A small extra inner-scroll often triggers the next Relay page.
   await page.evaluate("""() => {
     const arts=[...document.querySelectorAll('[role="article"]')].filter(e=>e.offsetWidth>0 && e.offsetHeight>0);
     let e=arts.length?arts[arts.length-1]:null;
     while(e){const s=getComputedStyle(e);if((s.overflowY==='auto'||s.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+50){e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll',{bubbles:true}));return;}e=e.parentElement;}
   }""")
   await page.wait_for_timeout(500)

   cur=len(rows)
   if cur==last:no_progress+=1
   else:no_progress=0;last=cur
   steps.append({"i":i,"n":cur,"clicked":clicked,"net":dict(net_stats),"scroll":scrollinfo,"no_progress":no_progress})
   if i%10==0:print(json.dumps(steps[-1],ensure_ascii=False),flush=True)
   if no_progress>=12:break

  if tasks:await asyncio.gather(*tasks,return_exceptions=True)
  (OUT/"comments.jsonl").write_text("\n".join(json.dumps(x,ensure_ascii=False) for x in rows.values())+"\n",encoding="utf-8")
  (OUT/"steps.json").write_text(json.dumps(steps,ensure_ascii=False,indent=2),encoding="utf-8")
  summary={"comments_from_graphql":len(rows),"net":net_stats,"steps":len(steps),"last":steps[-1] if steps else None}
  (OUT/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
  print(json.dumps(summary,ensure_ascii=False),flush=True)
  await browser.close()
asyncio.run(main())

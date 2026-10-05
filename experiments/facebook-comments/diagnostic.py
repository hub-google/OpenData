import asyncio,json,os,re,urllib.parse
from pathlib import Path
from playwright.async_api import async_playwright
TARGET=os.environ.get("TARGET_URL")
OUT=Path("fb_diag"); OUT.mkdir(exist_ok=True); (OUT/"graphql").mkdir(exist_ok=True)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(channel="chrome",headless=True,args=["--disable-blink-features=AutomationControlled"])
  ctx=await browser.new_context(locale="en-US",viewport={"width":1440,"height":1800},
    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
  page=await ctx.new_page(); reqs=[]; resps=[]; actions=[]
  def onreq(req):
   if "facebook.com/api/graphql" in req.url and req.method=="POST":
    pd=req.post_data or ""; q=dict(urllib.parse.parse_qsl(pd,keep_blank_values=True))
    reqs.append({"friendly":q.get("fb_api_req_friendly_name"),"doc_id":q.get("doc_id"),"variables":q.get("variables"),"post_data":pd,"headers":req.headers})
  async def onresp(resp):
   if "facebook.com/api/graphql" in resp.url:
    try:
     b=await resp.body(); i=len(resps)
     (OUT/"graphql"/f"{i:03d}.bin").write_bytes(b)
     resps.append({"status":resp.status,"bytes":len(b)})
    except Exception as e: resps.append({"error":str(e)})
  page.on("request",onreq); page.on("response",onresp)
  await page.goto(TARGET,wait_until="domcontentloaded",timeout=120000)
  try: await page.get_by_text("Most relevant",exact=True).wait_for(state="attached",timeout=12000)
  except: pass
  await page.wait_for_timeout(500)

  async def remove_login():
   ds=page.locator('[role="dialog"]'); n=await ds.count()
   for i in reversed(range(n)):
    try:
     t=(await ds.nth(i).inner_text(timeout=400))[:1000]
     if ("See more from" in t and ("Log in" in t or "Create new account" in t)) or "Log into Facebook" in t:
      await ds.nth(i).evaluate("(el)=>el.remove()"); actions.append({"removed_login":True})
    except: pass
   await page.evaluate("()=>{document.body.style.overflow='auto';document.documentElement.style.overflow='auto'}")
  await remove_login()

  # Open sorting menu with the actual Facebook control.
  mr=page.get_by_text("Most relevant",exact=True)
  actions.append({"most_relevant_count":await mr.count()})
  if await mr.count():
   b=mr.last.locator("xpath=ancestor::*[@role='button'][1]")
   await b.evaluate("(el)=>el.click()")
   await page.wait_for_timeout(800)
  (OUT/"menu.txt").write_text(await page.locator("body").inner_text(),encoding="utf-8")
  actions.append({"all_comments_count":await page.get_by_text("All comments",exact=True).count()})

  ac=page.get_by_text("All comments",exact=True)
  if not await ac.count(): raise RuntimeError("All comments option not found")
  # click menu option; it may be role=menuitem/radio
  await ac.last.evaluate("(el)=>el.click()")
  await page.wait_for_timeout(2500)
  await remove_login()
  body=await page.locator("body").inner_text()
  (OUT/"after_sort.txt").write_text(body,encoding="utf-8")
  actions.append({"after_sort_has_all": "All comments" in body, "after_sort_has_most":"Most relevant" in body, "reqs_after_sort":len(reqs)})

  # Click View more twice after sorting to capture pagination request under All comments.
  for i in range(2):
   vm=page.get_by_text("View more comments",exact=True)
   actions.append({"iter":i,"view_more_count":await vm.count()})
   if not await vm.count(): break
   el=vm.last.locator("xpath=ancestor::*[@role='button'][1]")
   await el.evaluate("(el)=>el.click()")
   await page.wait_for_timeout(1800)
   await remove_login()

  (OUT/"requests.json").write_text(json.dumps(reqs,ensure_ascii=False,indent=2),encoding="utf-8")
  (OUT/"responses.json").write_text(json.dumps(resps,ensure_ascii=False,indent=2),encoding="utf-8")
  (OUT/"actions.json").write_text(json.dumps(actions,ensure_ascii=False,indent=2),encoding="utf-8")
  print(json.dumps({"requests":[{"friendly":x["friendly"],"doc_id":x["doc_id"],"variables":x["variables"]} for x in reqs],"responses":resps,"actions":actions},ensure_ascii=False))
  await browser.close()
asyncio.run(main())

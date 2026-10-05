import asyncio, json, os, re
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

TARGET=os.environ.get("TARGET_URL")
OUT=Path("fb_diag"); OUT.mkdir(exist_ok=True); (OUT/"graphql").mkdir(exist_ok=True)

def qparam(url,key):
    try: return parse_qs(urlparse(url).query).get(key,[None])[0]
    except: return None

async def collect(page,seen):
    arts=page.locator('[role="article"]'); n=min(await arts.count(),5000)
    for j in range(n):
        a=arts.nth(j)
        try:
            txt=(await a.inner_text(timeout=800)).strip()
            hrefs=await a.locator('a[href*="comment_id"]').evaluate_all("(els)=>els.map(e=>e.href)")
            cids=[qparam(h,"comment_id") for h in hrefs if qparam(h,"comment_id")]
            key=(cids[0] if cids else None) or txt
            if txt and key not in seen:
                seen[key]={"comment_id":cids[0] if cids else None,"text":txt,"hrefs":hrefs[:3]}
        except: pass

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(channel="chrome",headless=True,args=["--disable-blink-features=AutomationControlled"])
    ctx=await browser.new_context(locale="en-US",viewport={"width":1440,"height":1800},
      user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
    page=await ctx.new_page(); seen={}; reqs=[]; resps=[]; actions=[]

    def on_request(req):
      if "graphql" in req.url.lower():
        try:
          reqs.append({"url":req.url,"method":req.method,"post_data":req.post_data,"headers":req.headers})
        except Exception as e: reqs.append({"error":str(e),"url":req.url})
    async def on_response(resp):
      if "graphql" in resp.url.lower():
        try:
          b=await resp.body(); n=len(resps)+1
          (OUT/"graphql"/f"{n:04d}.bin").write_bytes(b)
          resps.append({"url":resp.url,"status":resp.status,"bytes":len(b),"content_type":await resp.header_value("content-type")})
        except Exception as e: resps.append({"error":str(e),"url":resp.url})
    page.on("request",on_request); page.on("response",on_response)

    await page.goto(TARGET,wait_until="domcontentloaded",timeout=120000)

    # Act as soon as public comments are rendered, before/while the logged-out upsell appears.
    try:
      await page.get_by_text("View more comments",exact=True).wait_for(state="attached",timeout=12000)
    except: pass
    await page.wait_for_timeout(500)
    await collect(page,seen)
    (OUT/"before.txt").write_text(await page.locator("body").inner_text(),encoding="utf-8")
    (OUT/"before.html").write_text(await page.content(),encoding="utf-8")

    # Inspect dialogs; remove only the login/upsell dialog, never the post permalink dialog.
    ds=page.locator('[role="dialog"]')
    dcnt=await ds.count()
    dtexts=[]
    for i in range(dcnt):
      try: dtexts.append((await ds.nth(i).inner_text(timeout=1000))[:1200])
      except: dtexts.append("")
    actions.append({"dialogs":dtexts})
    for i in reversed(range(dcnt)):
      t=dtexts[i]
      if ("See more from" in t and ("Log in" in t or "Create new account" in t)) or ("Log into Facebook" in t):
        try:
          await ds.nth(i).evaluate("(el)=>el.remove()")
          actions.append({"removed_dialog_index":i,"text":t[:300]})
        except Exception as e: actions.append({"remove_error":str(e)})
    await page.evaluate("()=>{document.body.style.overflow='auto';document.documentElement.style.overflow='auto'}")

    for i in range(12):
      await collect(page,seen)
      body=await page.locator("body").inner_text()
      m=re.search(r"(\d[\d,]*)\s+of\s+(\d[\d,]*)",body)
      vm=page.get_by_text("View more comments",exact=True)
      cnt=await vm.count()
      actions.append({"iter":i,"view_more_count":cnt,"progress":m.groups() if m else None,"articles":len(seen),"graphql_reqs":len(reqs)})
      if not cnt: break
      try:
        # use closest clickable role=button
        el=vm.last.locator("xpath=ancestor::*[@role='button'][1]")
        if not await el.count(): el=vm.last
        await el.evaluate("(el)=>el.click()")
        actions.append({"iter":i,"clicked":True})
        await page.wait_for_timeout(1800)
        # remove only regenerated login upsell
        ds2=page.locator('[role="dialog"]'); n2=await ds2.count()
        for k in reversed(range(n2)):
          try:
            tt=(await ds2.nth(k).inner_text(timeout=500))[:1000]
            if ("See more from" in tt and ("Log in" in tt or "Create new account" in tt)) or ("Log into Facebook" in tt):
              await ds2.nth(k).evaluate("(el)=>el.remove()")
          except: pass
      except Exception as e:
        actions.append({"iter":i,"click_error":str(e)}); break

    await collect(page,seen)
    (OUT/"after.txt").write_text(await page.locator("body").inner_text(),encoding="utf-8")
    (OUT/"after.html").write_text(await page.content(),encoding="utf-8")
    (OUT/"articles.json").write_text(json.dumps(list(seen.values()),ensure_ascii=False,indent=2),encoding="utf-8")
    (OUT/"requests.json").write_text(json.dumps(reqs,ensure_ascii=False,indent=2),encoding="utf-8")
    (OUT/"responses.json").write_text(json.dumps(resps,ensure_ascii=False,indent=2),encoding="utf-8")
    (OUT/"actions.json").write_text(json.dumps(actions,ensure_ascii=False,indent=2),encoding="utf-8")
    summary={"articles":len(seen),"comment_ids":sum(bool(x.get("comment_id")) for x in seen.values()),"graphql_requests":len(reqs),"graphql_responses":len(resps),"actions":actions}
    print(json.dumps(summary,ensure_ascii=False))
    (OUT/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    await browser.close()
asyncio.run(main())

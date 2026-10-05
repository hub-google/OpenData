import asyncio, json, os, re
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

TARGET = os.environ.get("TARGET_URL", "https://www.facebook.com/chiangwanan/posts/pfbid0evMdVBKwyEsdgsoPZEfWj1PERJfQZNEGtATLVLYoyVShwonSRQnSmL1ntKY2L68Fl")
OUT = Path("fb_diag")
OUT.mkdir(exist_ok=True)
(OUT/"graphql").mkdir(exist_ok=True)

def qparam(url, key):
    try:
        return parse_qs(urlparse(url).query).get(key, [None])[0]
    except Exception:
        return None

async def collect_articles(page, seen):
    arts = page.locator('[role="article"]')
    n = min(await arts.count(), 5000)
    for j in range(n):
        a = arts.nth(j)
        try:
            txt = (await a.inner_text(timeout=1000)).strip()
            aria = await a.get_attribute("aria-label")
            hrefs = await a.locator('a[href*="comment_id"]').evaluate_all("(els)=>els.map(e=>e.href)")
            cids = [qparam(h, "comment_id") for h in hrefs if qparam(h, "comment_id")]
            key = (cids[0] if cids else None) or ((aria or "") + "\n" + txt)
            if txt and key not in seen:
                seen[key] = {"comment_id": cids[0] if cids else None, "aria_label": aria, "text": txt, "comment_hrefs": hrefs[:5]}
        except Exception:
            pass

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True, args=["--disable-blink-features=AutomationControlled"])
        context = await browser.new_context(
            locale="en-US", viewport={"width":1440,"height":1800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
        page = await context.new_page()
        seq=0; meta=[]; actions=[]; progress=[]; seen={}

        async def on_response(resp):
            nonlocal seq
            try:
                if "graphql" in resp.url.lower():
                    body=await resp.body()
                    seq+=1
                    (OUT/"graphql"/f"{seq:04d}.bin").write_bytes(body)
                    meta.append({"n":seq,"url":resp.url,"status":resp.status,"bytes":len(body),"content_type":(await resp.header_value("content-type"))})
            except Exception as e:
                meta.append({"error":str(e)})

        page.on("response", on_response)
        await page.goto(TARGET, wait_until="domcontentloaded", timeout=120000)
        await page.wait_for_timeout(7000)
        await collect_articles(page,seen)
        (OUT/"initial.html").write_text(await page.content(),encoding="utf-8")
        (OUT/"initial.txt").write_text(await page.locator("body").inner_text(),encoding="utf-8")
        await page.screenshot(path=str(OUT/"initial.png"),full_page=True)

        # Facebook shows a logged-out sign-in dialog. We do NOT log in; remove only the visual modal
        # and invoke the already-rendered public "View more comments" control via DOM click.
        try:
            dialogs=await page.locator('[role="dialog"]').count()
            actions.append({"action":"dialogs_initial","count":dialogs})
            await page.locator('[role="dialog"]').evaluate_all("(els)=>els.forEach(e=>e.remove())")
            await page.evaluate("()=>{document.documentElement.style.overflow='auto';document.body.style.overflow='auto';}")
        except Exception as e:
            actions.append({"action":"dialog_remove_error","error":str(e)})

        for i in range(8):
            await collect_articles(page,seen)
            body=await page.locator("body").inner_text()
            m=re.search(r"(\d[\d,]*)\s+of\s+(\d[\d,]*)",body)
            progress.append({"iter":i,"loaded":m.group(1) if m else None,"total":m.group(2) if m else None,"articles":len(seen),"graphql":seq})
            loc=page.locator('[role="button"]').filter(has_text=re.compile(r"^View more comments$"))
            cnt=await loc.count()
            actions.append({"iter":i,"action":"locator","count":cnt})
            if cnt==0: break
            try:
                el=loc.last
                # Direct DOM click bypasses the login overlay's pointer interception.
                await el.evaluate("(el)=>el.click()")
                actions.append({"iter":i,"action":"dom_click"})
                await page.wait_for_timeout(2200)
                # If FB regenerated the login modal, remove it again.
                await page.locator('[role="dialog"]').evaluate_all("(els)=>els.forEach(e=>e.remove())")
                await collect_articles(page,seen)
                await page.screenshot(path=str(OUT/f"after_{i+1:02d}.png"),full_page=False)
            except Exception as e:
                actions.append({"iter":i,"action":"click_error","error":str(e)})
                break

        await collect_articles(page,seen)
        (OUT/"final.txt").write_text(await page.locator("body").inner_text(),encoding="utf-8")
        (OUT/"final.html").write_text(await page.content(),encoding="utf-8")
        (OUT/"articles.json").write_text(json.dumps(list(seen.values()),ensure_ascii=False,indent=2),encoding="utf-8")
        (OUT/"graphql_meta.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding="utf-8")
        (OUT/"actions.json").write_text(json.dumps(actions,ensure_ascii=False,indent=2),encoding="utf-8")
        (OUT/"progress.json").write_text(json.dumps(progress,ensure_ascii=False,indent=2),encoding="utf-8")
        summary={"articles":len(seen),"with_comment_id":sum(bool(x.get("comment_id")) for x in seen.values()),"graphql_responses":seq,"last_progress":progress[-1] if progress else None,"actions":actions}
        (OUT/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
        print(json.dumps(summary,ensure_ascii=False))
        await browser.close()

asyncio.run(main())

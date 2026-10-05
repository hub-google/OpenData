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
            txt = (await a.inner_text(timeout=1500)).strip()
            aria = await a.get_attribute("aria-label")
            hrefs = await a.locator('a[href*="comment_id"]').evaluate_all("(els)=>els.map(e=>e.href)")
            comment_ids = [qparam(h, "comment_id") for h in hrefs if qparam(h, "comment_id")]
            key = (comment_ids[0] if comment_ids else None) or ((aria or "") + "\n" + txt)
            if txt and key not in seen:
                seen[key] = {
                    "comment_id": comment_ids[0] if comment_ids else None,
                    "aria_label": aria,
                    "text": txt,
                    "comment_hrefs": hrefs[:5],
                }
        except Exception:
            pass

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        context = await browser.new_context(
            locale="en-US",
            viewport={"width": 1440, "height": 1800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        )
        page = await context.new_page()
        seq = 0
        meta, actions, progress = [], [], []
        seen = {}

        async def on_response(resp):
            nonlocal seq
            try:
                u = resp.url.lower()
                if "graphql" in u or "/api/" in u:
                    ct = (await resp.header_value("content-type")) or ""
                    if "json" in ct or "graphql" in u:
                        body = await resp.body()
                        if len(body) < 15_000_000:
                            seq += 1
                            fn = OUT/"graphql"/f"{seq:04d}.bin"
                            fn.write_bytes(body)
                            meta.append({"n": seq, "url": resp.url, "status": resp.status, "content_type": ct, "bytes": len(body)})
            except Exception as e:
                meta.append({"error": str(e), "url": getattr(resp, "url", "")})

        page.on("response", on_response)
        await page.goto(TARGET, wait_until="domcontentloaded", timeout=120000)
        await page.wait_for_timeout(8000)
        await collect_articles(page, seen)
        (OUT/"initial.txt").write_text(await page.locator("body").inner_text(), encoding="utf-8")
        (OUT/"initial.html").write_text(await page.content(), encoding="utf-8")
        await page.screenshot(path=str(OUT/"initial.png"), full_page=True)

        # Prefer All comments if Facebook exposes it to logged-out viewers.
        try:
            sort_btn = page.locator('[role="button"]').filter(has_text=re.compile(r"^Most relevant"))
            if await sort_btn.count():
                await sort_btn.first.click(timeout=5000)
                await page.wait_for_timeout(1200)
                (OUT/"sort_menu.txt").write_text(await page.locator("body").inner_text(), encoding="utf-8")
                allc = page.get_by_text("All comments", exact=True)
                if await allc.count() and await allc.first.is_visible():
                    await allc.first.click(timeout=5000)
                    actions.append({"action":"sort","value":"All comments"})
                    await page.wait_for_timeout(1800)
        except Exception as e:
            actions.append({"action":"sort_error","error":str(e)})

        # Directly target the exact Facebook control. Each successful click should add another batch.
        for i in range(60):
            await collect_articles(page, seen)
            body = await page.locator("body").inner_text()
            m = re.search(r"(\d[\d,]*)\s+of\s+(\d[\d,]*)", body)
            if m:
                progress.append({"iter":i,"loaded":m.group(1),"total":m.group(2),"articles":len(seen)})
            loc = page.locator('[role="button"]').filter(has_text=re.compile(r"^View more comments$"))
            count = await loc.count()
            visible = []
            for k in range(count):
                try:
                    if await loc.nth(k).is_visible():
                        visible.append(k)
                except Exception:
                    pass
            if not visible:
                actions.append({"iter":i,"action":"no_view_more","count":count})
                break
            try:
                el = loc.nth(visible[-1])
                await el.scroll_into_view_if_needed()
                await el.click(timeout=5000)
                actions.append({"iter":i,"action":"view_more"})
                await page.wait_for_timeout(1400)
                if i in [0,1,4,9,19,39,59]:
                    await page.screenshot(path=str(OUT/f"after_{i+1:02d}.png"), full_page=False)
            except Exception as e:
                actions.append({"iter":i,"action":"click_error","error":str(e)})
                break

        await collect_articles(page, seen)
        final_body = await page.locator("body").inner_text()
        (OUT/"final.txt").write_text(final_body, encoding="utf-8")
        (OUT/"articles.json").write_text(json.dumps(list(seen.values()), ensure_ascii=False, indent=2), encoding="utf-8")
        (OUT/"graphql_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        (OUT/"actions.json").write_text(json.dumps(actions, ensure_ascii=False, indent=2), encoding="utf-8")
        (OUT/"progress.json").write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")
        await page.screenshot(path=str(OUT/"final.png"), full_page=True)

        summary = {
            "target": TARGET,
            "title": await page.title(),
            "url": page.url,
            "articles": len(seen),
            "with_comment_id": sum(1 for x in seen.values() if x.get("comment_id")),
            "graphql_responses": len([x for x in meta if "n" in x]),
            "view_more_clicks": sum(1 for x in actions if x.get("action")=="view_more"),
            "sort_all_comments": any(x.get("value")=="All comments" for x in actions),
            "last_progress": progress[-1] if progress else None,
        }
        print(json.dumps(summary, ensure_ascii=False))
        (OUT/"summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        await browser.close()

asyncio.run(main())

import asyncio, json, os, re, time
from pathlib import Path
from playwright.async_api import async_playwright

TARGET = os.environ.get("TARGET_URL", "https://www.facebook.com/chiangwanan/posts/pfbid0evMdVBKwyEsdgsoPZEfWj1PERJfQZNEGtATLVLYoyVShwonSRQnSmL1ntKY2L68Fl")
OUT = Path("fb_diag")
OUT.mkdir(exist_ok=True)
(OUT/"graphql").mkdir(exist_ok=True)

PAT = re.compile(r"(View more comments|See more comments|View previous comments|View more replies|See more replies|查看更多留言|顯示更多留言|查看更多回覆|顯示更多回覆)", re.I)

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
        meta = []

        async def on_response(resp):
            nonlocal seq
            try:
                if "graphql" in resp.url.lower():
                    ct = (await resp.header_value("content-type")) or ""
                    body = await resp.body()
                    if len(body) < 10_000_000:
                        seq += 1
                        fn = OUT/"graphql"/f"{seq:04d}.bin"
                        fn.write_bytes(body)
                        meta.append({"n": seq, "url": resp.url, "status": resp.status, "content_type": ct, "bytes": len(body)})
            except Exception as e:
                meta.append({"error": str(e), "url": getattr(resp, "url", "")})

        page.on("response", on_response)
        await page.goto(TARGET, wait_until="domcontentloaded", timeout=120000)
        await page.wait_for_timeout(10000)
        await page.screenshot(path=str(OUT/"initial.png"), full_page=True)
        (OUT/"initial.html").write_text(await page.content(), encoding="utf-8")
        (OUT/"initial.txt").write_text(await page.locator("body").inner_text(), encoding="utf-8")

        # Try to dismiss common overlays.
        for label in ["Close", "Not now", "Allow all cookies", "Only allow essential cookies"]:
            try:
                loc = page.get_by_role("button", name=re.compile(label, re.I))
                if await loc.count():
                    await loc.first.click(timeout=2000)
            except Exception:
                pass
        try:
            await page.keyboard.press("Escape")
        except Exception:
            pass

        seen_articles = {}
        actions=[]
        for i in range(80):
            # collect role=article snapshots (comments often render as articles)
            try:
                arts = page.locator('[role="article"]')
                n = min(await arts.count(), 1000)
                for j in range(n):
                    a = arts.nth(j)
                    try:
                        txt = (await a.inner_text(timeout=1000)).strip()
                        aria = await a.get_attribute("aria-label")
                        key = (aria or "") + "\n" + txt
                        if txt and key not in seen_articles:
                            seen_articles[key] = {"aria_label": aria, "text": txt}
                    except Exception:
                        pass
            except Exception:
                pass

            clicked=False
            # Find clickable elements by text, not brittle CSS classes.
            try:
                candidates = page.locator("div[role=button], span[role=button], a[role=button], button")
                cnt = min(await candidates.count(), 3000)
                for j in range(cnt):
                    el = candidates.nth(j)
                    try:
                        if not await el.is_visible():
                            continue
                        txt = ((await el.inner_text(timeout=300)) or "").strip()
                        if txt and PAT.search(txt):
                            actions.append({"iter": i, "text": txt[:200]})
                            await el.click(timeout=2000)
                            await page.wait_for_timeout(1200)
                            clicked=True
                            break
                    except Exception:
                        continue
            except Exception:
                pass

            if not clicked:
                await page.mouse.wheel(0, 1400)
                await page.wait_for_timeout(1000)
            if i % 10 == 0:
                await page.screenshot(path=str(OUT/f"step_{i:02d}.png"), full_page=False)

        (OUT/"articles.json").write_text(json.dumps(list(seen_articles.values()), ensure_ascii=False, indent=2), encoding="utf-8")
        (OUT/"graphql_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        (OUT/"actions.json").write_text(json.dumps(actions, ensure_ascii=False, indent=2), encoding="utf-8")
        (OUT/"final.txt").write_text(await page.locator("body").inner_text(), encoding="utf-8")
        await page.screenshot(path=str(OUT/"final.png"), full_page=True)
        summary = {
            "target": TARGET,
            "title": await page.title(),
            "url": page.url,
            "articles": len(seen_articles),
            "graphql_responses": len([x for x in meta if "n" in x]),
            "click_actions": len(actions),
        }
        print(json.dumps(summary, ensure_ascii=False))
        (OUT/"summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        await browser.close()

asyncio.run(main())

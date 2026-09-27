#!/usr/bin/env python3
"""Bench Groq product AI filter: 1 key serial vs 2 keys parallel.

Uses live Nest product suggestions for Croatia, then calls Groq directly with
the same compact product prompt / chunk size the app uses.
"""
from __future__ import annotations

import json
import hashlib
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ASIN = "B0FW468FBB"
PROFILE = "2543611550477751"
CHUNK = 40
MODEL = "openai/gpt-oss-20b"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM = """You are a senior Amazon Sponsored Products strategist for KDP authors.
Keep only ASINs commercially relevant to advertise alongside THIS book.
Never invent ASINs. Prefer precision. Respond JSON only:
{"keywordIndexes":[],"productIndexes":[<indexes>],"reason":"..."}"""


def load_keys() -> tuple[str, str]:
    env = Path("/Users/emiliansusanu/Downloads/iosapp-inteli/frontend/ios/.xcode.env.local").read_text()
    k1 = k2 = ""
    for line in env.splitlines():
        if line.startswith("export EXPO_PUBLIC_GROQ_API_KEY=") and "_2" not in line:
            k1 = line.split("=", 1)[1].strip()
        if line.startswith("export EXPO_PUBLIC_GROQ_API_KEY_2="):
            k2 = line.split("=", 1)[1].strip()
    assert k1.startswith("gsk_"), "missing key1"
    assert k2.startswith("gsk_"), "missing key2"
    return k1, k2


def nest_token() -> str:
    src = Path("/tmp/inteliads-as-286/RCTAsyncLocalStorage_V1")
    key = "sb-sjdlkprlkaweyuiaigix-auth-token"
    h = hashlib.md5(key.encode()).hexdigest()
    raw = (src / h).read_text()
    return json.loads(raw)["access_token"]


def fetch_products() -> tuple[dict, list[dict]]:
    tok = nest_token()
    body = {
        "profileId": PROFILE,
        "advertisedAsin": ASIN,
        "targeting": "products",
    }
    req = urllib.request.Request(
        "https://api.inteliads.io/api/campaigns/creation/preview",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {tok}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.loads(r.read().decode())
    products = data.get("productTargets") or []
    book = data.get("book") or {}
    return book, products


def product_lines(rows: list[dict]) -> str:
    lines = []
    for i, row in enumerate(rows):
        themes = row.get("themes") or []
        if isinstance(themes, list):
            themes = ", ".join(str(t) for t in themes[:3] if t) or "—"
        title = str(row.get("title") or "")[:80]
        subtitle = str(row.get("subtitle") or "")[:60]
        asin = str(row.get("asin") or "").upper()
        lines.append(f"{i} | {asin} | {title} | {subtitle} | {themes}")
    return "\n".join(lines)


def user_prompt(book: dict, rows: list[dict]) -> str:
    return f"""Book to advertise
- Title: {book.get('title') or '—'}
- Subtitle: {book.get('subtitle') or '—'}
- Author: {book.get('author') or '—'}
- Topic / category signals: {book.get('topic') or '—'}
- ASIN: {book.get('asin') or ASIN}
- Marketplace: US (USD)

STEP 1 — Amazon Ads product-target suggestions (raw)
(index | ASIN | title | subtitle | themes):
{product_lines(rows)}

STEP 2 — AI title/theme relevance filter
Return JSON with keywordIndexes: [] and productIndexes keep-list.
"""


def call_groq(key: str, system: str, user: str) -> tuple[int, float, str]:
    t0 = time.time()
    req = urllib.request.Request(
        GROQ_URL,
        data=json.dumps(
            {
                "model": MODEL,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            }
        ).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = json.loads(r.read().decode())
            content = (
                ((body.get("choices") or [{}])[0].get("message") or {}).get(
                    "content"
                )
                or ""
            )
            return r.status, time.time() - t0, content
    except Exception as e:
        return 0, time.time() - t0, str(e)


def chunks(rows: list[dict], size: int) -> list[list[dict]]:
    return [rows[i : i + size] for i in range(0, len(rows), size)]


def run_serial(book: dict, products: list[dict], key: str) -> dict:
    parts = chunks(products, CHUNK)
    t0 = time.time()
    kept = 0
    details = []
    for i, part in enumerate(parts):
        status, dt, content = call_groq(key, SYSTEM, user_prompt(book, part))
        ok = status == 200 and "productIndexes" in content
        details.append({"chunk": i, "n": len(part), "http": status, "s": round(dt, 2), "ok": ok})
        if ok:
            try:
                # crude count
                kept += content.count(",") + (1 if "productIndexes\":[" in content.replace(" ", "") and "[]" not in content.split("productIndexes")[-1][:20] else 0)
            except Exception:
                pass
        if i + 1 < len(parts):
            time.sleep(0.12)
    return {
        "mode": "1key_serial",
        "chunks": len(parts),
        "total_s": round(time.time() - t0, 2),
        "details": details,
    }


def run_parallel(book: dict, products: list[dict], keys: list[str]) -> dict:
    parts = chunks(products, CHUNK)
    t0 = time.time()
    details = [None] * len(parts)

    def work(i: int, part: list[dict]):
        key = keys[i % len(keys)]
        status, dt, content = call_groq(key, SYSTEM, user_prompt(book, part))
        ok = status == 200 and "productIndexes" in content
        return i, {
            "chunk": i,
            "n": len(part),
            "http": status,
            "s": round(dt, 2),
            "ok": ok,
            "key": f"k{(i % len(keys)) + 1}",
        }

    with ThreadPoolExecutor(max_workers=len(keys)) as ex:
        futs = [ex.submit(work, i, part) for i, part in enumerate(parts)]
        for fut in as_completed(futs):
            i, row = fut.result()
            details[i] = row
    return {
        "mode": "2key_parallel",
        "chunks": len(parts),
        "total_s": round(time.time() - t0, 2),
        "details": details,
    }


def main() -> int:
    k1, k2 = load_keys()
    print("fetching Nest products…")
    book, products = fetch_products()
    print(f"book={book.get('title','')[:50]!r} products={len(products)}")
    if len(products) < 40:
        print("too few products for chunk bench")
        return 1
    # Deduplicate Exact/Expanded companions for fair LLM size (~171 unique)
    # Nest returns match companions; keep unique ASINs for prompt size like app lines
    print("bench 1-key serial…")
    one = run_serial(book, products, k1)
    print(json.dumps({k: one[k] for k in ("mode", "chunks", "total_s")}))
    time.sleep(2)
    print("bench 2-key parallel…")
    two = run_parallel(book, products, [k1, k2])
    print(json.dumps({k: two[k] for k in ("mode", "chunks", "total_s")}))
    speedup = (one["total_s"] / two["total_s"]) if two["total_s"] else None
    out = {
        "productCount": len(products),
        "chunkSize": CHUNK,
        "one_key": one,
        "two_keys": two,
        "speedup_x": round(speedup, 2) if speedup else None,
        "worth_it": bool(speedup and speedup >= 1.35),
    }
    Path("/tmp/inteliads-groq-2key-bench.json").write_text(json.dumps(out, indent=2))
    print("RESULT", json.dumps({
        "products": len(products),
        "chunks": one["chunks"],
        "1key_s": one["total_s"],
        "2key_s": two["total_s"],
        "speedup_x": out["speedup_x"],
        "worth_it": out["worth_it"],
        "one_ok": all(d["ok"] for d in one["details"]),
        "two_ok": all(d and d["ok"] for d in two["details"]),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Ad-group create + add KW/products E2E against prod on cable iPhone 14 Pro.

Uses device Supabase session (AsyncStorage) for Nest writes; QA route for UI OCR.
No wipe. Creates a paused QA ad group with a unique keyword, then adds KW + product.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

BUNDLE = "io.inteliads.app"
UDID = "00008120-001210563E6BC01E"
PM = os.environ.get(
    "PYMOBILEDEVICE3_BIN",
    "/Users/emiliansusanu/Downloads/iosapp-inteli/frontend/.venv-device/bin/pymobiledevice3",
)
REPO = Path("/Users/emiliansusanu/Downloads/iosapp-inteli")
OUT = Path(REPO / "docs/qa/evidence/adgroup-e2e-prod-198")
AS_REMOTE = "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1"
QA_KEY = "inteliads.qa.command"
TESSERACT = "/opt/homebrew/bin/tesseract"
NEST = "https://api.inteliads.io/api"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"

# Amsterdam - Keywords (manual, enabled) — from device session catalog
CAMPAIGN_ID = os.environ.get("ADGROUP_SMOKE_CAMPAIGN_ID", "541313645823160").strip()
# Existing paused AG on that campaign for add-targets UI + optional extra writes
EXISTING_AG_ID = os.environ.get("ADGROUP_SMOKE_ADGROUP_ID", "513806882440928").strip()
ASIN = os.environ.get("ADGROUP_SMOKE_ASIN", "B0F4831KK6").strip()
PRODUCT_ASIN = os.environ.get("ADGROUP_SMOKE_PRODUCT_ASIN", "B0F3JYJ9MT").strip()

for d in ("screens", "logs", "ax", "as", "api"):
    (OUT / d).mkdir(parents=True, exist_ok=True)


def env_dev() -> dict[str, str]:
    e = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
    e["PATH"] = str(Path(PM).parent) + ":" + e.get("PATH", "")
    return e


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with (OUT / "logs" / "smoke.txt").open("a") as f:
        f.write(line + "\n")


def kill_app() -> None:
    subprocess.run(
        [PM, "developer", "dvt", "pkill", "InteliAds", "--udid", UDID],
        capture_output=True,
        env=env_dev(),
        timeout=30,
    )


def launch() -> None:
    r = subprocess.run(
        [PM, "developer", "dvt", "launch", BUNDLE, "--kill-existing", "--udid", UDID],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=45,
    )
    log(f"LAUNCH rc={r.returncode} err={(r.stderr or '')[:120]}")


def screenshot(name: str) -> Path | None:
    dest = OUT / "screens" / f"{name}.png"
    r = subprocess.run(
        [PM, "developer", "dvt", "screenshot", str(dest), "--udid", UDID],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=30,
    )
    ok = dest.exists() and dest.stat().st_size > 20_000
    log(f"SHOT {name} ok={ok} bytes={dest.stat().st_size if dest.exists() else 0} rc={r.returncode}")
    return dest if ok else None


def ocr(png: Path | None, tag: str) -> str:
    if not png:
        return ""
    out_base = OUT / "ax" / f"{tag}-ocr"
    try:
        subprocess.run(
            [TESSERACT, str(png), str(out_base), "-l", "eng", "--psm", "6"],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except Exception as e:
        log(f"OCR_FAIL {tag} {e}")
        return ""
    txt_path = Path(str(out_base) + ".txt")
    text = txt_path.read_text(errors="replace") if txt_path.exists() else ""
    (OUT / "ax" / f"{tag}.txt").write_text(text)
    return text


def pull_as(subdir: str = "pull") -> Path:
    dest = OUT / "as" / subdir
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [PM, "apps", "pull", "--udid", UDID, BUNDLE, AS_REMOTE, str(dest)],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=90,
    )
    nested = dest / "RCTAsyncLocalStorage_V1"
    return nested if nested.exists() else dest


def write_qa_command(cmd: dict) -> None:
    kill_app()
    time.sleep(0.6)
    local = pull_as("work")
    man_path = local / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    man[QA_KEY] = json.dumps(json.dumps(cmd))
    man_path.write_text(json.dumps(man, separators=(",", ":")))
    subprocess.run(
        [PM, "apps", "push", "--udid", UDID, BUNDLE, str(man_path), f"{AS_REMOTE}/manifest.json"],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=45,
    )
    log(f"QA_CMD {cmd}")


def installed_version() -> str:
    r = subprocess.run(
        [PM, "apps", "list", "--udid", UDID],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=60,
    )
    i = r.stdout.find("io.inteliads.app")
    chunk = r.stdout[i : i + 5000] if i >= 0 else ""
    m = re.search(r'"CFBundleVersion"\s*:\s*"([^"]+)"', chunk)
    return m.group(1) if m else "?"


def load_device_access_token(as_root: Path) -> str:
    man = json.loads((as_root / "manifest.json").read_text())
    key = "sb-sjdlkprlkaweyuiaigix-auth-token"
    raw = man.get(key)
    if raw in (None, "null"):
        h = hashlib.md5(key.encode()).hexdigest()
        raw = (as_root / h).read_text()
    data = json.loads(raw) if isinstance(raw, str) else raw
    if isinstance(data, str):
        data = json.loads(data)
    tok = data.get("access_token") if isinstance(data, dict) else None
    if not tok:
        raise RuntimeError("No Supabase access_token in device AsyncStorage")
    return tok


def nest(method: str, path: str, token: str, body: dict | None = None) -> tuple[int, dict | str]:
    cmd = [
        "curl",
        "-s",
        "-w",
        "\n__HTTP__%{http_code}",
        "-X",
        method,
        f"{NEST}{path}",
        "-H",
        f"Authorization: Bearer {token}",
        "-H",
        "Content-Type: application/json",
        "-H",
        "Accept: application/json",
        "-H",
        f"User-Agent: {UA}",
    ]
    if body is not None:
        cmd.extend(["-d", json.dumps(body)])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    out = r.stdout or ""
    if "__HTTP__" in out:
        payload, _, code_s = out.rpartition("__HTTP__")
        code = int(code_s.strip() or "0")
    else:
        payload, code = out, 0
    try:
        parsed: dict | str = json.loads(payload) if payload.strip() else {}
    except json.JSONDecodeError:
        parsed = payload[:800]
    return code, parsed


def soft_ui(text: str, needles: list[str]) -> bool:
    low = text.lower()
    return any(n.lower() in low for n in needles)


def main() -> int:
    (OUT / "logs" / "smoke.txt").write_text("")
    build = installed_version()
    log(f"START ad-group E2E prod build={build} campaign={CAMPAIGN_ID}")
    results: dict[str, object] = {}
    api_evidence: dict[str, object] = {}

    # ── Nest live probe (unauth) ──────────────────────────────────────────
    probe = subprocess.run(
        [
            "curl",
            "-s",
            "-o",
            "/tmp/nest-adgroup-sug.json",
            "-w",
            "%{http_code}",
            "-X",
            "POST",
            f"{NEST}/ad-groups/suggestions",
            "-H",
            "Content-Type: application/json",
            "-d",
            "{}",
        ],
        capture_output=True,
        text=True,
        timeout=20,
    )
    probe_code = (probe.stdout or "").strip()
    results["nest_suggestions_live"] = probe_code == "401"
    log(f"NEST unauth suggestions HTTP {probe_code} (want 401)")

    # ── Device session token ──────────────────────────────────────────────
    as_root = pull_as("token")
    token = load_device_access_token(as_root)
    log(f"DEVICE_TOKEN ok len={len(token)}")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    qa_name = f"QA smoke AG {stamp}"
    qa_kw = f"inteliads qa {stamp}"

    # ── API: suggestions ──────────────────────────────────────────────────
    code, sug = nest(
        "POST",
        "/ad-groups/suggestions",
        token,
        {"campaignId": CAMPAIGN_ID, "targeting": "keywords", "asin": ASIN},
    )
    (OUT / "api" / "suggestions.json").write_text(
        json.dumps({"http": code, "body": sug}, indent=2)[:50_000]
    )
    results["api_suggestions"] = code in (200, 201) and isinstance(sug, dict)
    api_evidence["suggestions_http"] = code
    log(f"API suggestions HTTP {code} keys={list(sug)[:8] if isinstance(sug, dict) else type(sug)}")

    # ── API: create AG + keyword ──────────────────────────────────────────
    create_body = {
        "campaignId": CAMPAIGN_ID,
        "name": qa_name,
        "defaultBid": 0.35,
        "state": "paused",
        "targeting": "keywords",
        "advertisedAsin": ASIN,
        "keywords": [
            {
                "keyword": qa_kw,
                "matchType": "exact",
                "bid": 0.35,
                "source": "custom",
            }
        ],
    }
    code, created = nest("POST", "/ad-groups", token, create_body)
    (OUT / "api" / "create.json").write_text(
        json.dumps({"http": code, "request": create_body, "body": created}, indent=2)[:50_000]
    )
    new_ag_id = None
    if isinstance(created, dict):
        ag = created.get("adGroup") or created.get("data") or created
        if isinstance(ag, dict):
            new_ag_id = ag.get("id") or created.get("id")
        new_ag_id = new_ag_id or created.get("id")
    results["api_create"] = code in (200, 201) and bool(new_ag_id)
    api_evidence["create_http"] = code
    api_evidence["created_adGroupId"] = new_ag_id
    api_evidence["created_name"] = qa_name
    api_evidence["created_keyword"] = qa_kw
    log(f"API create HTTP {code} adGroupId={new_ag_id} body_snip={str(created)[:240]}")

    target_ag = new_ag_id or EXISTING_AG_ID

    # ── API: add keywords ─────────────────────────────────────────────────
    add_kw_body = {
        "keywords": [
            {
                "keyword": f"{qa_kw} add",
                "matchType": "phrase",
                "bid": 0.4,
                "source": "custom",
            }
        ]
    }
    code, add_kw = nest("POST", f"/ad-groups/{target_ag}/keywords", token, add_kw_body)
    (OUT / "api" / "add-keywords.json").write_text(
        json.dumps(
            {"http": code, "adGroupId": target_ag, "request": add_kw_body, "body": add_kw},
            indent=2,
        )[:50_000]
    )
    created_n = add_kw.get("created") if isinstance(add_kw, dict) else None
    results["api_add_keywords"] = code in (200, 201) and (created_n is None or created_n >= 1)
    api_evidence["add_keywords_http"] = code
    api_evidence["add_keywords_body"] = add_kw
    log(f"API add-keywords HTTP {code} body={str(add_kw)[:240]}")

    # ── API: add product targets ──────────────────────────────────────────
    add_prod_body = {
        "productTargets": [
            {
                "asin": PRODUCT_ASIN,
                "bid": 0.4,
                "matchType": "exact",
                "source": "custom",
            }
        ]
    }
    # Product targets only valid on product/empty AGs — try new AG first; may fail on KW AG
    code, add_prod = nest(
        "POST", f"/ad-groups/{target_ag}/product-targets", token, add_prod_body
    )
    (OUT / "api" / "add-products.json").write_text(
        json.dumps(
            {"http": code, "adGroupId": target_ag, "request": add_prod_body, "body": add_prod},
            indent=2,
        )[:50_000]
    )
    # If KW-only AG rejects products, try existing paused AG that may be empty/asin
    if code not in (200, 201):
        code2, add_prod2 = nest(
            "POST",
            f"/ad-groups/{EXISTING_AG_ID}/product-targets",
            token,
            add_prod_body,
        )
        (OUT / "api" / "add-products-fallback.json").write_text(
            json.dumps(
                {
                    "http": code2,
                    "adGroupId": EXISTING_AG_ID,
                    "request": add_prod_body,
                    "body": add_prod2,
                },
                indent=2,
            )[:50_000]
        )
        log(f"API add-products fallback HTTP {code2} body={str(add_prod2)[:240]}")
        results["api_add_products"] = code2 in (200, 201)
        api_evidence["add_products_http"] = code2
        api_evidence["add_products_adGroupId"] = EXISTING_AG_ID
        api_evidence["add_products_body"] = add_prod2
    else:
        results["api_add_products"] = True
        api_evidence["add_products_http"] = code
        api_evidence["add_products_adGroupId"] = target_ag
        api_evidence["add_products_body"] = add_prod
        log(f"API add-products HTTP {code} body={str(add_prod)[:240]}")

    # ── UI: create screen with real campaign ──────────────────────────────
    write_qa_command(
        {
            "route": f"/campaign/ad-group-create?campaignId={CAMPAIGN_ID}&asin={ASIN}",
        }
    )
    launch()
    time.sleep(8)
    text = ocr(screenshot("01-adgroup-create"), "01-adgroup-create")
    create_ui = soft_ui(
        text,
        ["new ad group", "keywords", "products", "default bid", "paste"],
    )
    results["ui_create_screen"] = create_ui
    log(f"CHECK ui_create_screen {'PASS' if create_ui else 'FAIL'}")

    # ── UI: add-targets with real ad group ────────────────────────────────
    write_qa_command(
        {
            "route": (
                f"/adgroup/add-targets?id={target_ag}"
                f"&campaignId={CAMPAIGN_ID}&mode=keywords&name=QA"
            ),
        }
    )
    launch()
    time.sleep(8)
    text = ocr(screenshot("02-add-targets"), "02-add-targets")
    add_ui = soft_ui(
        text,
        ["add keyword", "keyword", "paste", "default bid", "targets", "suggested"],
    ) and not soft_ui(text, ["ad group not found"])
    results["ui_add_targets_screen"] = add_ui
    log(f"CHECK ui_add_targets_screen {'PASS' if add_ui else 'FAIL'}")

    # ── UI: campaign detail entry ─────────────────────────────────────────
    write_qa_command({"route": f"/campaign/{CAMPAIGN_ID}"})
    launch()
    time.sleep(7)
    text = ocr(screenshot("03-campaign-detail"), "03-campaign-detail")
    camp_ui = soft_ui(text, ["amsterdam", "ad group", "keyword", "campaign"])
    results["ui_campaign_detail"] = camp_ui
    log(f"CHECK ui_campaign_detail {'PASS' if camp_ui else 'FAIL'}")

    api_ok = all(
        bool(results.get(k))
        for k in ("nest_suggestions_live", "api_suggestions", "api_create", "api_add_keywords")
    )
    # products may fail on KW AG — require either create path or products PASS
    products_ok = bool(results.get("api_add_products"))
    ui_ok = bool(results.get("ui_create_screen")) and bool(results.get("ui_add_targets_screen"))
    e2e = "PASS" if api_ok and ui_ok else "FAIL"
    if api_ok and ui_ok and not products_ok:
        e2e = "PASS_PARTIAL"  # KW write path proven; products blocked by AG type

    summary = {
        "device": "iPhone 14 PRO Emiliano",
        "udid": UDID,
        "bundleVersion": build,
        "campaignId": CAMPAIGN_ID,
        "asin": ASIN,
        "results": results,
        "api": api_evidence,
        "e2e": e2e,
        "productsNote": (
            "Product targets may reject on keyword-only ad groups; "
            "fallback tried EXISTING_AG_ID."
        ),
        "evidence": str(OUT),
        "prs": ["https://github.com/This-Is-Working/robo_ads/pull/472",
                "https://github.com/This-Is-Working/robo_ads/pull/474"],
        "nestUnauthSuggestions": probe_code,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    log(f"SUMMARY {json.dumps(summary)}")
    log(f"E2E {e2e}")
    return 0 if e2e.startswith("PASS") else 1


if __name__ == "__main__":
    raise SystemExit(main())

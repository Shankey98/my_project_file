#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minimal SeleniumBase UC probe: can UC load korail search page w/o -8003?"""
import os, sys, json, time
from seleniumbase import SB
HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(HERE, "uc-profile2")
os.makedirs(PROFILE, exist_ok=True)
out = {"ok": False}
try:
    with SB(uc=True, test=True, user_data_dir=PROFILE, headless2=True,
            headed=False, disable_csp=True) as sb:
        sb.driver.set_window_size(1440, 1000)
        print("STEP nav", flush=True)
        sb.open("https://www.korail.com/ticket/search/general")
        time.sleep(3)
        url = sb.get_current_url()
        title = sb.get_title()
        body = sb.get_text("body")
        out["url"] = url
        out["title"] = title
        out["body_len"] = len(body)
        out["body_snippet"] = body[:400]
        out["blocked"] = "-8003" in body or "8003" in body
        out["has_lookup"] = "열차 조회" in body
        sb.save_screenshot(os.path.join(HERE, "uc-probe.png"))
        out["ok"] = True
        print("RESULT", json.dumps(out, ensure_ascii=False), flush=True)
except Exception as e:
    import traceback
    out["error"] = "".join(traceback.format_exception_only(type(e), e))
    print("EXC", out["error"], flush=True)
print("DONE", json.dumps(out, ensure_ascii=False), flush=True)
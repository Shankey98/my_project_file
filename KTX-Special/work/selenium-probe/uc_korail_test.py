#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SeleniumBase UC(undetected) mode로 코레일 실좌석 조회 검증.
목표: -8003 차단 없이 열차 좌석 상태(특실/일반)를 읽을 수 있는지 확인.
"""
import os, sys, io, json, time
from seleniumbase import SB

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(HERE, "uc-profile")
os.makedirs(PROFILE, exist_ok=True)
OUT = {
    "test": "seleniumbase-uc-korail",
    "date": "2026-11-25",
    "chrome": None,
    "steps": [],
    "result": None,
}

def log(sb, msg):
    print("STEP:", msg, flush=True)
    OUT["steps"].append({"t": time.strftime("%H:%M:%S"), "msg": msg})

def click_station(sb, station_name, which):
    """which: 'start'(출발) or 'end'(도착). opens station popup and clicks the station by text."""
    # opener anchors: two a.btn_pop-open (start first in DOM, then end)
    openers = sb.find_elements("css selector", 'a[class*="btn_pop-open"]')
    if len(openers) < 2:
        log(sb, f"opener count={len(openers)} (expected 2)")
        return False
    idx = 0 if which == "start" else 1
    sb.scroll_to(openers[idx])
    openers[idx].click()
    time.sleep(0.8)
    log(sb, f"opened {which} popup")
    # click the station text (first exact match)
    try:
        xp = f'//*[self::a or self::button][normalize-space(.)="{station_name}"]'
        sb.click(xp, timeout=5)
    except Exception as e:
        log(sb, f"click {station_name} failed: {e}")
        return False
    time.sleep(0.8)
    return True

def main():
    try:
        with SB(uc=True, test=True, user_data_dir=PROFILE,
                headed=True, disable_csp=True) as sb:
            sb.driver.set_window_size(1440, 1000)
            log(sb, "UC launched, going to korail search")
            sb.open("https://www.korail.com/ticket/search/general")
            time.sleep(2)
            try:
                sb.wait_for_text("열차 조회", timeout=20)
            except Exception as e:
                log(sb, f"search form not found: {e}")
            body = sb.get_text("body")
            OUT["steps"].append({"initial_body_snippet": body[:300]})

            # date: startDate already 2026-12-05 08:00 (kept by site?) - log it
            val = sb.get_attribute("#startDate", "value")
            log(sb, f"startDate value = {val}")

            # pick stations
            ok_start = click_station(sb, "서울", "start")
            sv = sb.get_attribute("#labelstart", "value") if sb.is_element_present("#labelstart") else ""
            log(sb, f"after start click -> labelstart='{sv}' (ok={ok_start})")

            ok_end = click_station(sb, "포항", "end")
            ev = sb.get_attribute("#labelend", "value") if sb.is_element_present("#labelend") else ""
            log(sb, f"after end click -> labelend='{ev}' (ok={ok_end})")

            # if labels still empty, try the station list (2nd match) fallback
            if sv != "서울":
                log(sb, "start not applied, retry with list index")
                # reopen start popup
                openers = sb.find_elements("css selector", 'a[class*="btn_pop-open"]')
                if openers:
                    openers[0].click(); time.sleep(0.8)
                try:
                    sb.click('//*[self::a or self::button][normalize-space(.)="서울"][1]', timeout=3)
                except Exception:
                    # click 2nd match
                    sb.click('(//*[self::a or self::button][normalize-space(.)="서울"])[2]', timeout=3)
                time.sleep(0.5)

            # click search
            log(sb, "clicking 열차 조회")
            sb.click("button.btn_lookup")
            time.sleep(5)
            url = sb.get_current_url()
            log(sb, f"after search url={url}")

            # wait for results or block
            time.sleep(3)
            txt = sb.get_text("body")
            OUT["url_after"] = url
            OUT["result_text"] = txt

            # classify
            blocked = "8003" in txt
            no_train = "운행하는 열차가 없습니다" in txt
            ktx = "KTX" in txt or "산천" in txt
            outcome = "blocked(-8003)" if blocked else ("no_trains" if no_train else ("trains" if ktx else "unknown"))
            OUT["result"] = outcome
            log(sb, f"RESULT={outcome}")
            sb.save_screenshot(os.path.join(HERE, "uc-korail-result.png"))
            OUT["screenshot"] = "uc-korail-result.png"

    except Exception as e:
        import traceback
        OUT["error"] = "".join(traceback.format_exception_only(type(e), e))
        log(None, f"EXCEPTION: {e}")

    print("\n===== JSON =====")
    print(json.dumps(OUT, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
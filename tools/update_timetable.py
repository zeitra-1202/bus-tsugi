#!/usr/bin/env python3
"""NAVITIMEの区間時刻表から timetable.js を作り直す。

ダイヤ改正のときに `python3 tools/update_timetable.py` を実行する。
NAVITIMEは連続取得すると一時的に403で弾くので、弾かれたら時間を空けるか、
同じ手順をブラウザのコンソールで行う（2026-10-01の初回はブラウザで取得）。
平日＝木曜、土日祝＝日曜の時刻表を取る（土曜と日祝は同じダイヤだったので1つにまとめている）。
区間を足すときは STOPS と ROUTES に書き足す。バス停コードは NAVITIME の poi?node= の値。
"""
import datetime as dt
import html
import json
import pathlib
import re
import subprocess
import time

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"

STOPS = {
    "daihatsu": ("00410668", "ダイハツ前"),
    "numazu": ("00083258", "沼津駅"),
    "otemachi": ("00243899", "大手町"),
    "yae": ("00305936", "八重"),
    "futasegawa": ("00243825", "二瀬川"),
}

ROUTES = [
    ("daihatsu", "numazu"),
    ("otemachi", "daihatsu"),
    ("numazu", "yae"),
    ("yae", "numazu"),
    ("futasegawa", "otemachi"),
    ("otemachi", "futasegawa"),
]


def get(url):
    # urllib だと NAVITIME に 403 で弾かれるので curl で取る
    body = subprocess.run(["curl", "-sf", "-A", UA, url], check=True,
                          capture_output=True).stdout.decode("utf-8")
    time.sleep(0.5)
    return body


def lines_at(node):
    body = get(f"https://www.navitime.co.jp/poi?node={node}")
    return sorted(set(re.findall(r"lineId=(\d+)&(?:amp;)?updown", body)))


def text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def scrape(dep, arr, line, date):
    url = (f"https://www.navitime.co.jp/bus/diagram/timelist?departure={dep}"
           f"&arrival={arr}&line={line}&date={date}")
    body = get(url)
    out = []
    for block in re.findall(r'<ul class="time-detail">(.*?)</ul>\s*</li>', body, re.S):
        d = re.search(r'class="time dep">([^<]+)<', block)
        a = re.search(r'class="time arr">([^<]+)<', block)
        name = re.search(r'<span class="name">(.*?)</span>', block, re.S)
        dest = re.search(r'<span class="last-node">(.*?)</span>', block, re.S)
        if not (d and a and name):
            continue
        out.append((d.group(1).strip(), a.group(1).strip(), text(name.group(1)),
                    text(dest.group(1)) if dest else ""))
    return out


def compact(item):
    dep, arr, name, dest = item
    company = "T" if name.startswith("東海") else "I"
    m = re.search(r"\[([^\]]+)\]", name)
    label = m.group(1) if m else ""
    if "休校" in name:
        label = "休校日のみ"
    return "|".join([dep, arr, company, label, re.sub(r"行$", "", dest)])


def next_weekday(start, weekday):
    return start + dt.timedelta(days=(weekday - start.weekday()) % 7)


def main():
    today = dt.date.today()
    dates = {
        "weekday": next_weekday(today, 3).isoformat(),  # 木曜
        "holiday": next_weekday(today, 6).isoformat(),  # 日曜
    }
    data = {}
    for a, b in ROUTES:
        dep, arr = STOPS[a][0], STOPS[b][0]
        lines = lines_at(dep)
        key = f"{a}_{b}"
        data[key] = {}
        for kind, date in dates.items():
            seen, items = set(), []
            for line in lines:
                for it in scrape(dep, arr, line, date):
                    if it not in seen:
                        seen.add(it)
                        items.append(it)
            items.sort()
            data[key][kind] = [compact(i) for i in items]
            print(f"{key:24s} {kind:8s} {len(items):3d}本")
    stops = {k: v[1] for k, v in STOPS.items()}
    routes = [{"id": f"{a}_{b}", "from": a, "to": b} for a, b in ROUTES]
    payload = {"fetched": today.isoformat(), "stops": stops, "routes": routes, "timetable": data}
    out = pathlib.Path(__file__).resolve().parent.parent / "timetable.js"
    out.write_text("// tools/update_timetable.py が作るファイル。手で直さない。\n"
                   "// 1本＝\"発|着|会社(I=伊豆箱根 T=東海)|系統|行き先\"\n"
                   "window.BUS_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    print("→", out)


if __name__ == "__main__":
    main()

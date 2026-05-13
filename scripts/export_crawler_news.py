#!/usr/bin/env python3
import json
import re
from typing import List, Dict

import requests
from bs4 import BeautifulSoup

UA = {"User-Agent": "Mozilla/5.0"}
TIMEOUT = 20


def norm(s: str) -> str:
    return " ".join((s or "").split()).strip()


def crawl_nfra() -> List[Dict]:
    out = []
    try:
        url = "https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemIdAndChild"
        rows = requests.get(url, params={"itemId": 928, "pageSize": 12, "pageIndex": 1}, headers=UA, timeout=TIMEOUT).json().get("data", {}).get("rows", [])
        for i, r in enumerate(rows[:8], 1):
            t = norm(r.get("docTitle", ""))
            if not t:
                continue
            out.append({
                "id": f"nfra-{i}",
                "title": t,
                "source": "国家金融监督管理总局",
                "url": f"https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId={r.get('docId')}&itemId=928",
                "publish_time": (r.get("publishDate", "") or "")[:10],
                "content": norm(r.get("docSummary") or t),
                "category": "政策监管",
                "score": 88,
                "tags": ["监管", "政策"],
            })
    except Exception:
        pass
    return out


def crawl_csrc() -> List[Dict]:
    out = []
    try:
        page = "http://www.csrc.gov.cn/csrc/c100028/common_xq_list.shtml"
        s = requests.Session()
        html = s.get(page, headers=UA, timeout=TIMEOUT).text
        m = re.search(r'name="channelid"\s+content="([a-f0-9]+)"', html)
        if not m:
            return out
        ch = m.group(1)
        api = f"http://www.csrc.gov.cn/searchList/{ch}"
        data = s.get(api, params={"_isAgg": "true", "_isJson": "true", "_pageSize": 12, "_page": "1"}, headers={**UA, "Referer": page, "X-Requested-With": "XMLHttpRequest"}, timeout=TIMEOUT).json().get("data", {}).get("results", [])
        for i, x in enumerate(data[:8], 1):
            t = norm(x.get("title", ""))
            if not t:
                continue
            out.append({
                "id": f"csrc-{i}",
                "title": t,
                "source": "中国证监会",
                "url": x.get("url", ""),
                "publish_time": str(x.get("publishedTimeStr", ""))[:10],
                "content": t,
                "category": "政策监管",
                "score": 90,
                "tags": ["监管", "证券"],
            })
    except Exception:
        pass
    return out


def crawl_pbc() -> List[Dict]:
    out = []
    try:
        html = requests.get("https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html", headers=UA, timeout=TIMEOUT).text
        txt = "\n".join(BeautifulSoup(html, "html.parser").stripped_strings)
        for line in txt.split("\n"):
            line = norm(line)
            m = re.search(r"(20\d{2}-\d{2}-\d{2})", line)
            if not m:
                continue
            title = norm(line.replace(m.group(1), ""))
            if len(title) < 8:
                continue
            out.append({
                "id": f"pbc-{len(out)+1}",
                "title": title,
                "source": "中国人民银行",
                "url": "https://www.pbc.gov.cn/",
                "publish_time": m.group(1),
                "content": title,
                "category": "政策监管",
                "score": 89,
                "tags": ["宏观", "政策"],
            })
            if len(out) >= 6:
                break
    except Exception:
        pass
    return out


def crawl_generic(name: str, url: str, category: str) -> List[Dict]:
    out = []
    try:
        html = requests.get(url, headers=UA, timeout=TIMEOUT, allow_redirects=True).text
        s = BeautifulSoup(html, "html.parser")
        seen = set()
        for a in s.select("a[href]"):
            title = norm(a.get_text(" ", strip=True))
            if len(title) < 12:
                continue
            h = a.get("href", "")
            if h.startswith("//"):
                h = "https:" + h
            if h.startswith("/"):
                h = requests.compat.urljoin(url, h)
            if not h.startswith("http"):
                continue
            if not re.search(r"\d{6,}|article|news|content|/p/|/a/|/detail|/\d{4}/\d{2}", h):
                continue
            k = (title[:60], h)
            if k in seen:
                continue
            seen.add(k)
            out.append({
                "id": f"{name}-{len(out)+1}",
                "title": title,
                "source": name,
                "url": h,
                "publish_time": "",
                "content": title,
                "category": category,
                "score": 70,
                "tags": [category],
            })
            if len(out) >= 6:
                break
    except Exception:
        pass
    return out


def main():
    items = []
    items += crawl_nfra()
    items += crawl_csrc()
    items += crawl_pbc()
    items += crawl_generic("界面", "https://www.jiemian.com/", "金融行业")
    items += crawl_generic("第一财经", "https://www.yicai.com/", "金融行业")
    items += crawl_generic("证券时报", "https://www.stcn.com/", "金融行业")
    items += crawl_generic("量子位", "https://www.qbitai.com/", "AI技术")
    items += crawl_generic("雷峰网", "https://www.leiphone.com/", "AI技术")

    # simple dedupe
    seen = set()
    out = []
    for it in items:
        k = (it["title"][:60], it["url"])
        if k in seen:
            continue
        seen.add(k)
        out.append(it)

    out_path = "/home/ubuntu/linggan/finance-ai-landing-new/finance-ai-landing/project_mvp/data/crawler_news.json"
    import os
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"exported {len(out)} -> {out_path}")


if __name__ == "__main__":
    main()

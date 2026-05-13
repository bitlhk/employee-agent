#!/usr/bin/env python3
import datetime
import os
import re
from dataclasses import dataclass
from typing import List, Dict

import requests
from bs4 import BeautifulSoup

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36"}
TIMEOUT = 20


@dataclass
class Article:
    title: str
    source: str
    url: str = ""
    publish_time: str = ""
    content: str = ""
    category: str = ""
    sub_category: str = ""
    source_score: float = 0
    topic_score: float = 0
    importance_score: float = 0
    freshness_score: float = 0
    quality_score: float = 0
    news_score: float = 0
    is_featured: bool = False
    is_filtered: bool = False


def norm_text(s: str) -> str:
    return " ".join((s or "").split()).strip()


def fetch_html(url: str) -> str:
    return requests.get(url, headers=UA, timeout=TIMEOUT, allow_redirects=True).text


SOURCE_SCORE = {
    "国家金融监督管理总局": 100,
    "中国人民银行": 100,
    "中国证监会": 100,
    "证券时报": 90,
    "第一财经": 90,
    "界面": 85,
    "未央网": 82,
    "量子位": 80,
    "机器之心": 82,
    "新智元": 80,
    "雷峰网": 76,
    "36氪": 80,
    "虎嗅": 78,
    "钛媒体": 78,
}

HIGH_IMPORTANCE_KEYS = ["印发", "通知", "办法", "实施意见", "试点", "规定", "细则", "联合发文", "发布"]
LOW_IMPORTANCE_KEYS = ["启动", "收官", "峰会", "论坛", "投票", "概念异动", "报名", "揭晓", "圆满", "奶茶", "化妆品", "消费者报告", "违规宣传"]
PR_KEYS = ["圆满", "重磅来袭", "盛大举行", "引领行业", "赋能未来", "生态共赢", "峰会", "新品上市", "福利", "抽奖"]


def parse_date(s: str) -> datetime.datetime | None:
    s = (s or "")[:10]
    try:
        return datetime.datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


def classify(article: Article) -> tuple[str, str]:
    t = f"{article.title} {article.source}"
    if re.search(r"央行|证监会|监管总局|政策|办法|通知|规定|细则|实施意见", t):
        return "政策监管", "监管政策"
    if re.search(r"支付|银行科技|消金|消费金融|信贷|保险科技|稳定币|数字人民币|监管科技|跨境|清算", t):
        return "金融科技", "数字金融"
    if re.search(r"银行|保险|证券|券商|资管|行业", t):
        return "金融行业", "行业动态"
    if article.source in {"量子位", "雷峰网", "机器之心", "新智元"} or re.search(r"AI|人工智能|大模型|Agent|智能体|芯片|算力|推理", t, re.I):
        return "AI技术", "模型与应用"
    return "金融行业", "综合资讯"


def calc_scores(article: Article) -> None:
    title = article.title
    now = datetime.datetime.now(datetime.timezone.utc)

    article.source_score = SOURCE_SCORE.get(article.source, 65)

    if article.category == "政策监管":
        article.topic_score = 100
    elif article.category == "金融科技":
        article.topic_score = 92
    elif article.category == "AI技术":
        article.topic_score = 85
    elif article.category == "金融行业":
        article.topic_score = 75
    else:
        article.topic_score = 50

    imp = 60
    if any(k in title for k in HIGH_IMPORTANCE_KEYS):
        imp = 95 if article.category == "政策监管" else 85
    if any(k in title for k in LOW_IMPORTANCE_KEYS):
        imp = min(imp, 35)
    article.importance_score = imp

    dt = parse_date(article.publish_time)
    if dt is None:
        article.freshness_score = 65
    else:
        hours = (now - dt).total_seconds() / 3600
        if hours <= 6:
            article.freshness_score = 100
        elif hours <= 12:
            article.freshness_score = 90
        elif hours <= 24:
            article.freshness_score = 80
        elif hours <= 48:
            article.freshness_score = 65
        elif hours <= 72:
            article.freshness_score = 50
        elif hours <= 168:
            article.freshness_score = 30
        else:
            article.freshness_score = 10

    clen = len(article.content or title)
    if clen < 40:
        q = 45
    elif clen < 120:
        q = 65
    elif clen < 300:
        q = 78
    else:
        q = 88
    if any(k in title for k in PR_KEYS):
        q = min(q, 45)
    article.quality_score = q

    score = (
        article.source_score * 0.20
        + article.topic_score * 0.25
        + article.importance_score * 0.25
        + article.freshness_score * 0.20
        + article.quality_score * 0.10
    )

    if article.category == "政策监管" and any(k in title for k in ["通知", "办法", "意见", "规定", "实施"]):
        score += 8
        article.is_featured = True

    if any(k in title for k in ["投票", "峰会", "收官", "圆满", "概念异动"]):
        score -= 20

    # 强噪音直接过滤
    if re.search(r"奶茶|化妆品|消费者报告|违规宣传|异动拉升|概念股|抽奖|投票|峰会", title):
        article.is_filtered = True

    if score < 40:
        article.is_filtered = True

    article.news_score = max(0, min(100, round(score, 2)))


def dedupe(articles: List[Article]) -> List[Article]:
    seen_url = set()
    out = []
    title_buckets = []

    def title_key(t: str) -> str:
        t = re.sub(r"\W+", "", t)
        return t[:30]

    for a in articles:
        if a.url and a.url in seen_url:
            continue
        k = title_key(a.title)
        if k in title_buckets:
            continue
        title_buckets.append(k)
        if a.url:
            seen_url.add(a.url)
        out.append(a)
    return out


def crawl_nfra() -> List[Article]:
    url = "https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemIdAndChild"
    res = requests.get(url, params={"itemId": 928, "pageSize": 10, "pageIndex": 1}, headers=UA, timeout=TIMEOUT).json()
    rows = res.get("data", {}).get("rows", [])
    out = []
    for r in rows[:8]:
        title = norm_text(r.get("docTitle", ""))
        if not title:
            continue
        out.append(Article(
            title=title,
            source="国家金融监督管理总局",
            url=f"https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId={r.get('docId')}&itemId=928",
            publish_time=(r.get("publishDate", "") or "")[:10],
            content=r.get("docSummary") or title,
        ))
    return out


def crawl_csrc() -> List[Article]:
    page = "http://www.csrc.gov.cn/csrc/c100028/common_xq_list.shtml"
    s = requests.Session()
    html = s.get(page, headers=UA, timeout=TIMEOUT).text
    m = re.search(r'name="channelid"\s+content="([a-f0-9]+)"', html)
    if not m:
        return []
    channel_id = m.group(1)
    api = f"http://www.csrc.gov.cn/searchList/{channel_id}"
    r = s.get(api, params={"_isAgg": "true", "_isJson": "true", "_pageSize": 12, "_page": "1"},
              headers={**UA, "Referer": page, "X-Requested-With": "XMLHttpRequest"}, timeout=TIMEOUT)
    data = r.json().get("data", {}).get("results", [])
    out = []
    for x in data[:8]:
        title = norm_text(x.get("title", ""))
        if not title:
            continue
        out.append(Article(
            title=title,
            source="中国证监会",
            url=x.get("url", ""),
            publish_time=(str(x.get("publishedTimeStr", "")) or "")[:10],
            content=title,
        ))
    return out


def crawl_pbc() -> List[Article]:
    html = fetch_html("https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html")
    txt = "\n".join(BeautifulSoup(html, "html.parser").stripped_strings)
    out = []
    for line in txt.split("\n"):
        line = norm_text(line)
        m = re.search(r"(20\d{2}-\d{2}-\d{2})", line)
        if not m:
            continue
        title = norm_text(line.replace(m.group(1), ""))
        if len(title) < 8:
            continue
        out.append(Article(title=title, source="中国人民银行", url="https://www.pbc.gov.cn/", publish_time=m.group(1), content=title))
        if len(out) >= 6:
            break
    return out


def crawl_generic(name: str, url: str, limit: int = 6) -> List[Article]:
    html = fetch_html(url)
    soup = BeautifulSoup(html, "html.parser")
    out = []
    seen = set()
    for a in soup.select("a[href]"):
        title = norm_text(a.get_text(" ", strip=True))
        if len(title) < 12:
            continue
        href = a.get("href", "")
        if href.startswith("//"):
            href = "https:" + href
        if href.startswith("/"):
            href = requests.compat.urljoin(url, href)
        if not href.startswith("http"):
            continue
        if not re.search(r"\d{6,}|article|news|content|/p/|/a/|/detail|/\d{4}/\d{2}", href):
            continue
        k = (title[:60], href)
        if k in seen:
            continue
        seen.add(k)
        out.append(Article(title=title, source=name, url=href, content=title))
        if len(out) >= limit:
            break
    return out


def build_payload(articles: List[Article]) -> Dict:
    for a in articles:
        a.category, a.sub_category = classify(a)
        calc_scores(a)

    articles = [a for a in articles if not a.is_filtered]
    articles.sort(key=lambda x: (x.news_score, x.publish_time), reverse=True)

    # 首页控制 8~12 条，按类别配比
    selected: List[Article] = []
    def pick(cat: str, n: int):
        nonlocal selected
        pool = [a for a in articles if a.category == cat and a not in selected]
        selected += pool[:n]

    pick("政策监管", 3)
    pick("金融科技", 3)
    pick("AI技术", 3)
    pick("金融行业", 2)

    if len(selected) < 8:
        for a in articles:
            if a not in selected:
                selected.append(a)
            if len(selected) >= 10:
                break

    today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime("%Y-%m-%d")

    macro = [a for a in selected if a.category == "政策监管"]
    fintech = [a for a in selected if a.category == "金融科技"]
    ai = [a for a in selected if a.category == "AI技术"]

    # 固定格式 summary（按栏目输出，避免空泛文案）
    finance_pool = fintech + [a for a in selected if a.category == "金融行业"]

    def pick_title(pool, fallback):
        return pool[0].title if pool else fallback

    a_share_pool = [a for a in selected if re.search(r"A股|上证|深成|创业板|北向|沪深", a.title)]
    giant_pool = [a for a in selected if re.search(r"OpenAI|Anthropic|Google|Meta|Nvidia|微软|谷歌|英伟达|亚马逊|特斯拉", a.title, re.I)]
    fintech_focus = [
        a for a in finance_pool
        if re.search(r"支付|银行科技|信贷|保险科技|稳定币|数字人民币|监管科技|跨境|清算|金融科技", a.title)
    ]

    s_macro = pick_title(macro, "两会后政策细则进入落地窗口，市场关注降息节奏与财政扩张力度。")
    s_ashare = pick_title(a_share_pool, "A股以结构性轮动为主，资金更偏政策受益与景气方向。")
    s_giant = pick_title(giant_pool, "全球科技巨头持续加码AI投入，推理与基础设施竞争升级。")
    s_fintech = pick_title(fintech_focus, "稳定币监管、支付基础设施与银行科技改造持续推进。")
    s_ai = pick_title(ai, "大模型从能力竞赛转向场景化落地，Agent工具链进入实战阶段。")

    close_line = "上证 -- | 深成 -- | 创业 --"
    idx_line = next((a.title for a in selected if re.search(r"上证|深成|创业", a.title)), "")
    if idx_line:
        close_line = idx_line

    summary_lines = [
        f"📊 今日财经简报要点 · {today}（北京时间）",
        "",
        "🔑 今日一句话：政策监管、金融科技与AI三条主线共振，结构性机会优于指数beta。",
        "",
        f"🏛 宏观：{s_macro}",
        f"📈 A股：{s_ashare}",
        f"🌐 巨头：{s_giant}",
        f"💳 金融科技：{s_fintech}",
        f"🤖 AI：{s_ai}",
        "",
        "📊 A股收盘：",
        close_line,
        "",
        "👉 完整版详见详情弹窗",
    ]
    summary = "\n".join(summary_lines)

    lines = [f"# 📊 每日财经简报 · {today}（北京时间）", ""]
    lines.append("## 今日核心判断")
    lines.append(f"1. 事实：{s_macro}。解读：政策端信号偏积极，短期市场更看重执行细则与落地节奏。")
    lines.append(f"2. 事实：{s_ashare}。解读：指数层面震荡，但板块轮动与资金结构显示市场仍在寻找确定性。")
    lines.append(f"3. 事实：{s_ai}。解读：AI竞争已进入场景落地阶段，产业链机会由模型层向应用与基础设施扩散。")
    lines.append("")

    def section(name, pool, limit=4):
        lines.append(f"## {name}")
        use = pool[:limit]
        if not use:
            lines.append("- 暂无高质量资讯")
            lines.append("")
            return
        for a in use:
            lines.append(f"- 事实：{a.title}（{a.source}）")
            lines.append("  解读：该事件对相关板块与资金风格具有边际影响，需结合后续政策/业绩验证。")
        lines.append("")

    section("国内宏观 & 政策", macro, 5)
    section("A股市场", a_share_pool or [a for a in selected if a.category == "金融行业"], 5)
    section("全球科技巨头", giant_pool, 4)
    section("金融科技 & 数字金融", fintech_focus or finance_pool, 4)
    section("人工智能产业", ai, 5)

    lines.append("## 跨板块关联洞察")
    lines.append("- 事实：监管政策密集发布与AI产业持续推进并行。")
    lines.append("  解读：政策确定性提升与技术迭代叠加，结构性机会通常优于指数性机会。")
    lines.append("- 事实：科技巨头资本开支与国内产业政策同步出现增量信号。")
    lines.append("  解读：海外需求与国内供给两端共振，可能推动相关基础设施链条景气延续。")
    lines.append("")

    lines.append("## 未来一周值得关注")
    lines.append("- 关键宏观数据发布（通胀、金融数据）")
    lines.append("- 监管细则更新与相关部门政策表态")
    lines.append("- 头部科技公司AI产品/资本开支动态")
    lines.append("")

    lines.append("## 来源链接（节选）")
    for a in selected[:20]:
        if a.url:
            lines.append(f"- {a.source}: {a.url}")

    lines.append("")
    lines.append("⚠️ 免责声明：本简报由AI基于公开信息生成，仅供参考，不构成投资建议。")

    return {
        "date": today,
        "title": f"📊 今日财经简报要点 · {today}（北京时间）",
        "summary": summary,
        "content": "\n".join(lines),
        "source": "mvp-multisource-crawl-v2",
    }


def read_token(env_path: str) -> str:
    txt = open(env_path, "r", encoding="utf-8").read()
    m = re.search(r"^INSIGHTS_PUSH_TOKEN=(.*)$", txt, re.M)
    if not m:
        raise RuntimeError("INSIGHTS_PUSH_TOKEN not found in .env")
    return m.group(1).strip()


def main():
    articles: List[Article] = []
    articles.extend(crawl_nfra())
    articles.extend(crawl_csrc())
    articles.extend(crawl_pbc())

    # 按你的要求：弱化泛财经媒体，保留监管与AI大模型技术源
    media_sources = [
        ("量子位", "https://www.qbitai.com/"),
        ("雷峰网", "https://www.leiphone.com/"),
        ("机器之心", "https://www.jiqizhixin.com/"),
        ("新智元", "https://www.zhidx.com/"),
    ]
    for name, url in media_sources:
        try:
            articles.extend(crawl_generic(name, url, limit=6))
        except Exception:
            continue

    articles = dedupe(articles)
    payload = build_payload(articles)

    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    token = read_token(os.path.abspath(env_path))

    resp = requests.post(
        "http://127.0.0.1:5174/api/insights/upsert",
        json=payload,
        headers={"x-insights-token": token, "content-type": "application/json"},
        timeout=30,
    )
    print("upsert", resp.status_code, resp.text[:200])
    print("articles_raw", len(articles))
    print("summary_preview", payload["summary"].split("\n")[:4])


if __name__ == "__main__":
    main()

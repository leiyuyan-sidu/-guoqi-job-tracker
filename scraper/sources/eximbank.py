"""中国进出口银行官网"人才招聘"公告抓取。

结构和国资委官网（sasac.py）几乎一样：静态服务端渲染的公告列表 + 公告详情页，
但这个栏目本身就是"人才招聘"专栏，比国资委那个"人事招聘"栏目干净一些，
不过仍然会混着社会招聘、博士后招收这类非应届校招公告，需要按标题关键词粗筛。
"""

import re
from datetime import datetime, timedelta
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

FIRST_PAGE_URL = "http://www.eximbank.gov.cn/info/notice/recruit/"
LIST_URL_TMPL = "http://www.eximbank.gov.cn/info/notice/recruit/index_{page}.html"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}

CAMPUS_KEYWORDS = ["校招", "校园招聘", "应届", "毕业生"]
MAX_AGE_DAYS = 365  # 这家银行一年通常只发一次校招公告（秋季发布，次年才截止），窗口要放宽

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _looks_like_campus_recruitment(title):
    return any(kw in title for kw in CAMPUS_KEYWORDS)


def fetch_list(max_pages=3):
    """抓取最近几页的公告列表，只保留标题命中校招关键词、且发布日期不太旧的条目。"""
    cutoff = datetime.now() - timedelta(days=MAX_AGE_DAYS)
    items = []
    for page in range(1, max_pages + 1):
        url = FIRST_PAGE_URL if page == 1 else LIST_URL_TMPL.format(page=page)
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")

        for li in soup.find_all("li"):
            a = li.find("a")
            if not a or not a.get("href"):
                continue
            href = a["href"]
            if not href.endswith(".html") or href == "##":
                continue
            title_span = a.find("span", class_="title")
            title = title_span.get_text(strip=True) if title_span else a.get_text(strip=True)
            if not title or not _looks_like_campus_recruitment(title):
                continue

            time_span = a.find("span", class_="time")
            date_match = _DATE_RE.search(time_span.get_text(strip=True)) if time_span else None
            posted_at = date_match.group(0) if date_match else None
            if posted_at and datetime.strptime(posted_at, "%Y-%m-%d") < cutoff:
                continue

            items.append(
                {
                    "title": title,
                    "url": urljoin(url, href),
                    "posted_at": posted_at,
                }
            )
    return items


def fetch_detail(url):
    """抓取公告详情页正文。返回 {"text": 正文文字, "image_url": None}（暂未发现海报图片型公告）。"""
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.encoding = "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    container = soup.find("div", class_="TRS_Editor") or soup
    parts = [p.get_text(strip=True) for p in container.find_all("p") if p.get_text(strip=True)]
    text = "\n".join(parts)

    return {"text": text, "image_url": None}

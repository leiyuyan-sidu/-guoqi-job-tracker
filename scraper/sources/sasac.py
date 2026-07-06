"""国务院国资委官网"人事招聘"栏目公告抓取。

这个栏目是纯静态服务端渲染页面，不需要登录、不需要 JS 渲染，但和国聘不一样：
1. 栏目本身混杂了校园招聘、社会招聘、中层管理人员招聘、事业单位定向招考等各类公告，
   需要先按标题关键词粗筛，只保留看起来像"校招/应届"的公告。
2. 公告详情页是一整段无结构正文（不像国聘有单独的专业/学历字段），
   专业要求、学历要求、招聘单位这些都要交给大模型从正文里读出来。
"""

import re
from datetime import datetime, timedelta
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

FIRST_PAGE_URL = "http://www.sasac.gov.cn/n2588035/n2588325/n2588350/index.html"
LIST_URL_TMPL = "http://www.sasac.gov.cn/n2588035/n2588325/n2588350/index_20742332_{page}.html"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}

CAMPUS_KEYWORDS = ["校招", "校园招聘", "应届", "毕业生"]
MAX_AGE_DAYS = 120  # 栏目里偶尔混着好几年前的旧公告，超过这个天数的直接丢弃

_DATE_RE = re.compile(r"\[(\d{4}-\d{2}-\d{2})\]")


def _looks_like_campus_recruitment(title):
    return any(kw in title for kw in CAMPUS_KEYWORDS)


def fetch_list(max_pages=5):
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
            if "content.html" not in href:
                continue
            title = a.get_text(strip=True)
            if not title or title.startswith("专题"):
                continue
            if not _looks_like_campus_recruitment(title):
                continue

            span = li.find("span")
            date_match = _DATE_RE.search(span.get_text(strip=True)) if span else None
            posted_at = date_match.group(1) if date_match else None
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
    """抓取公告详情页。有的公告正文是文字，有的是一整张招聘海报图片（没有文字）。

    返回 {"text": 正文文字（可能为空）, "image_url": 海报图片地址（没有则为 None）}
    """
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.encoding = "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    container = soup.find("div", class_="zsy_comain") or soup
    parts = [p.get_text(strip=True) for p in container.find_all("p") if p.get_text(strip=True)]
    text = "\n".join(parts)

    image_url = None
    if len(text) < 30:
        img = container.find("img")
        if img and img.get("src"):
            image_url = urljoin(url, img["src"])

    return {"text": text, "image_url": image_url}

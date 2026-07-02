"""国聘（www.iguopin.com）校园招聘岗位抓取。

数据来自国聘的公开 JSON 接口，不需要登录、不需要浏览器渲染。
接口和参数是通过实际抓包确认的：
  POST https://gp-api.iguopin.com/api/jobs/v1/recom-job
  body: {"search": {"page": N, "page_size": 50, "nature": ["115xW5oQ"]}, "recom": {...}}
  "115xW5oQ" 是"校招"的 nature 编码。
"""

import time

import requests

API_URL = "https://gp-api.iguopin.com/api/jobs/v1/recom-job"
DETAIL_URL_TMPL = "https://www.iguopin.com/job/detail?id={job_id}"
NATURE_CAMPUS = "115xW5oQ"

HEADERS = {
    "device": "pc",
    "subsite": "iguopin",
    "version": "5.2.300",
    "content-type": "application/json",
    "accept": "application/json, text/plain, */*",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "referer": "https://www.iguopin.com/",
}


def fetch_all_campus_jobs(page_size=50, max_pages=60, sleep_sec=0.4):
    """分页拉取全部"校招"岗位，按 job_id 去重后返回原始 dict 列表。"""
    jobs = []
    seen_ids = set()
    page = 1
    while page <= max_pages:
        body = {
            "search": {"page": page, "page_size": page_size, "nature": [NATURE_CAMPUS]},
            "recom": {"update_time": True, "company_nature": True, "hot_job": True},
        }
        resp = requests.post(API_URL, headers=HEADERS, json=body, timeout=20)
        resp.raise_for_status()
        payload = resp.json().get("data", {})
        batch = payload.get("list", [])
        if not batch:
            break

        new_count = 0
        for j in batch:
            if j["job_id"] not in seen_ids:
                seen_ids.add(j["job_id"])
                jobs.append(j)
                new_count += 1

        total = payload.get("total", 0)
        if page * page_size >= total or new_count == 0:
            break
        page += 1
        time.sleep(sleep_sec)
    return jobs


def detail_url(job_id):
    return DETAIL_URL_TMPL.format(job_id=job_id)

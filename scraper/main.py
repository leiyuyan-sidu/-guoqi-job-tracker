import sys

import llm_match
from db import get_client, upsert_jobs
from match import check_disliked, is_blue_collar, rule_based_eligible
from sources import guopin, sasac


def build_row_guopin(job):
    major_cn = job.get("major_cn") or []
    contents = job.get("contents") or ""
    title = job.get("job_name")
    education = job.get("education_cn")

    if is_blue_collar(title, education):
        eligible, reason = False, f"学历要求「{education}」或岗位类型为技能/蓝领岗，非硕士管理类岗位，直接排除"
    else:
        eligible, reason = rule_based_eligible(major_cn, contents)
        if eligible is None:
            eligible, reason = llm_match.classify(major_cn, contents)

    interest_tag = check_disliked(
        job.get("job_name"), job.get("category_cn"), job.get("department_cn"), contents
    )

    locations = ", ".join(d.get("area_cn", "") for d in job.get("district_list") or [])

    return {
        "raw_key": f"guopin:{job['job_id']}",
        "source": "guopin",
        "company": job.get("company_name"),
        "title": job.get("job_name"),
        "location": locations,
        "education": job.get("education_cn"),
        "major_requirement": "、".join(major_cn),
        "description": contents,
        "eligible": eligible,
        "eligible_reason": reason,
        "interest_tag": interest_tag,
        "posted_at": job.get("create_time"),
        "deadline": job.get("end_time"),
        "url": guopin.detail_url(job["job_id"]),
    }


def build_row_sasac(item):
    title = item["title"]

    if is_blue_collar(title, None):
        return {
            "raw_key": f"sasac:{item['url']}",
            "source": "sasac",
            "company": "详见公告",
            "title": title,
            "location": None,
            "education": None,
            "major_requirement": None,
            "description": None,
            "eligible": False,
            "eligible_reason": "岗位类型为技能/蓝领岗，非硕士管理类岗位，直接排除",
            "interest_tag": None,
            "posted_at": item.get("posted_at"),
            "deadline": None,
            "url": item["url"],
        }

    detail = sasac.fetch_detail(item["url"])
    contents = detail["text"]
    data = llm_match.classify_freeform(title, contents, image_url=detail["image_url"])

    interest_tag = check_disliked(title, data["company"], contents)

    return {
        "raw_key": f"sasac:{item['url']}",
        "source": "sasac",
        "company": data["company"],
        "title": title,
        "location": None,
        "education": data["education"],
        "major_requirement": data["major_requirement"],
        "description": contents or "（公告为招聘海报图片，以上信息由 AI 识别图片内容提取，建议点开原文核实）",
        "eligible": data["is_campus"] and data["eligible"],
        "eligible_reason": data["reason"],
        "interest_tag": interest_tag,
        "posted_at": item.get("posted_at"),
        "deadline": None,
        "url": item["url"],
    }


def main():
    client = get_client()

    print("读取已入库的岗位（避免重复用大模型判断已经判过的岗位）…")
    existing = client.table("jobs").select("raw_key").execute()
    seen_keys = {r["raw_key"] for r in existing.data}
    print(f"  已有 {len(seen_keys)} 条")

    rows = []

    print("抓取国聘校招岗位…")
    jobs = guopin.fetch_all_campus_jobs()
    new_jobs = [j for j in jobs if f"guopin:{j['job_id']}" not in seen_keys]
    print(f"共抓到 {len(jobs)} 条，其中新岗位 {len(new_jobs)} 条，开始逐条判断是否符合报名条件…")
    for i, job in enumerate(new_jobs, 1):
        try:
            rows.append(build_row_guopin(job))
        except Exception as e:
            print(f"[跳过] guopin job_id={job.get('job_id')} 处理失败: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  已处理 {i}/{len(new_jobs)}")

    print("抓取国资委官网人事招聘公告…")
    items = sasac.fetch_list()
    new_items = [it for it in items if f"sasac:{it['url']}" not in seen_keys]
    print(f"共抓到 {len(items)} 条校招相关公告，其中新公告 {len(new_items)} 条，开始逐条判断…")
    for i, item in enumerate(new_items, 1):
        try:
            rows.append(build_row_sasac(item))
        except Exception as e:
            print(f"[跳过] sasac url={item.get('url')} 处理失败: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  已处理 {i}/{len(new_items)}")

    eligible_count = sum(1 for r in rows if r["eligible"])
    print(f"新增数据中可报名 {eligible_count} 条，写入 Supabase（含不符合的岗位，仅用于避免重复判断，前端只展示可报名的）…")

    upsert_jobs(client, rows)
    print("完成。")


if __name__ == "__main__":
    main()

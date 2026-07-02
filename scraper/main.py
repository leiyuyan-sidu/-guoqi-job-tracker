import sys

import llm_match
from db import get_client, upsert_jobs
from match import check_disliked, rule_based_eligible
from sources import guopin


def build_row(job):
    major_cn = job.get("major_cn") or []
    contents = job.get("contents") or ""

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


def main():
    client = get_client()

    print("读取已入库的岗位（避免重复用大模型判断已经判过的岗位）…")
    existing = client.table("jobs").select("raw_key").execute()
    seen_keys = {r["raw_key"] for r in existing.data}
    print(f"  已有 {len(seen_keys)} 条")

    print("抓取国聘校招岗位…")
    jobs = guopin.fetch_all_campus_jobs()
    new_jobs = [j for j in jobs if f"guopin:{j['job_id']}" not in seen_keys]
    print(f"共抓到 {len(jobs)} 条，其中新岗位 {len(new_jobs)} 条，开始逐条判断是否符合报名条件…")

    rows = []
    for i, job in enumerate(new_jobs, 1):
        try:
            rows.append(build_row(job))
        except Exception as e:
            print(f"[跳过] job_id={job.get('job_id')} 处理失败: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  已处理 {i}/{len(new_jobs)}")

    eligible_count = sum(1 for r in rows if r["eligible"])
    print(f"新岗位中可报名 {eligible_count} 条，写入 Supabase（含不符合的岗位，仅用于避免重复判断，前端只展示可报名的）…")

    upsert_jobs(client, rows)
    print("完成。")


if __name__ == "__main__":
    main()

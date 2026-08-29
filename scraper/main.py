import sys
import time

import llm_match
from db import get_client, upsert_jobs
from config import PROFILE
from match import check_disliked, check_graduation_year, is_blue_collar, rule_based_eligible
from sources import eximbank, guopin, sasac


def format_guopin_salary(job):
    """把国聘的结构化薪资转为适合前端展示的中文文本。"""
    if job.get("is_negotiable"):
        return "面议"
    minimum = int(job.get("min_wage") or 0)
    maximum = int(job.get("max_wage") or 0)
    unit = (job.get("wage_unit_cn") or "元/月").strip()
    if minimum and maximum:
        return f"{minimum:,}–{maximum:,} {unit}"
    if minimum:
        return f"{minimum:,} {unit}起"
    if maximum:
        return f"最高{maximum:,} {unit}"
    return None


def build_row_guopin(job):
    major_cn = job.get("major_cn") or []
    contents = job.get("contents") or ""
    title = job.get("job_name")
    education = job.get("education_cn")

    cohort_ok, cohort_reason = check_graduation_year(
        PROFILE["graduation_year"], title, contents
    )

    if cohort_ok is False:
        eligible, reason = False, cohort_reason
    elif is_blue_collar(title, education):
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
        "salary": format_guopin_salary(job),
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


def build_row_freeform(source, item, fetch_detail_fn):
    """国资委、进出口银行这类"公告是一整段无结构正文"的数据源共用的处理逻辑。"""
    title = item["title"]

    if is_blue_collar(title, None):
        return {
            "raw_key": f"{source}:{item['url']}",
            "source": source,
            "company": "详见公告",
            "title": title,
            "location": None,
            "salary": None,
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

    detail = fetch_detail_fn(item["url"])
    contents = detail["text"]
    cohort_ok, cohort_reason = check_graduation_year(
        PROFILE["graduation_year"], title, contents
    )
    data = llm_match.classify_freeform(title, contents, image_url=detail["image_url"])

    if cohort_ok is False:
        data["eligible"] = False
        data["reason"] = cohort_reason

    interest_tag = check_disliked(title, data["company"], contents)

    return {
        "raw_key": f"{source}:{item['url']}",
        "source": source,
        "company": data["company"],
        "title": title,
        "location": None,
        "salary": data["salary"],
        "education": data["education"],
        "major_requirement": data["major_requirement"],
        "description": contents or "（公告为招聘海报图片，以上信息由 AI 识别图片内容提取，建议点开原文核实）",
        "eligible": data["is_campus"] and data["target_cohort"] and data["eligible"],
        "eligible_reason": data["reason"],
        "interest_tag": interest_tag,
        "posted_at": item.get("posted_at"),
        "deadline": None,
        "url": item["url"],
    }


def run_freeform_source(source, fetch_list_fn, fetch_detail_fn, seen_keys, rows, label):
    print(f"抓取{label}…")
    items = fetch_list_fn()
    new_items = [it for it in items if f"{source}:{it['url']}" not in seen_keys]
    print(f"共抓到 {len(items)} 条校招相关公告，其中新公告 {len(new_items)} 条，开始逐条判断…")
    for i, item in enumerate(new_items, 1):
        try:
            rows.append(build_row_freeform(source, item, fetch_detail_fn))
        except Exception as e:
            print(f"[跳过] {source} url={item.get('url')} 处理失败: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  已处理 {i}/{len(new_items)}")


def recheck_existing_graduation_year(client):
    """把历史库中明确只面向其他届别的岗位移出前端，避免规则只对新增数据生效。"""
    result = client.table("jobs").select("id,title,description").eq("eligible", True).execute()
    excluded = 0
    for row in result.data:
        cohort_ok, reason = check_graduation_year(
            PROFILE["graduation_year"], row.get("title"), row.get("description")
        )
        if cohort_ok is False:
            client.table("jobs").update(
                {"eligible": False, "eligible_reason": reason}
            ).eq("id", row["id"]).execute()
            excluded += 1
    print(f"历史岗位届别复核完成：排除 {excluded} 条不面向{PROFILE['graduation_year']}届的岗位")


def backfill_guopin_salaries(client, jobs):
    """为已有国聘岗位补薪资；推荐列表缺失时再按岗位 ID 查询详情。"""
    try:
        existing = client.table("jobs").select("raw_key,salary").eq("source", "guopin").execute()
    except Exception:
        print("数据库尚未增加 salary 列，暂时跳过历史薪资回填")
        return

    missing_keys = {row["raw_key"] for row in existing.data if not row.get("salary")}
    updated = 0
    for job in jobs:
        raw_key = f"guopin:{job['job_id']}"
        salary = format_guopin_salary(job)
        if raw_key in missing_keys and salary:
            client.table("jobs").update({"salary": salary}).eq("raw_key", raw_key).execute()
            missing_keys.remove(raw_key)
            updated += 1

    # 推荐列表会随排序和岗位状态变化，仍缺失的历史岗位必须走详情接口。
    detail_updated = 0
    detail_failed = 0
    for raw_key in sorted(missing_keys):
        job_id = raw_key.removeprefix("guopin:")
        try:
            detail = guopin.fetch_job_detail(job_id)
            salary = format_guopin_salary(detail)
            if salary:
                client.table("jobs").update({"salary": salary}).eq("raw_key", raw_key).execute()
                detail_updated += 1
        except Exception as exc:
            detail_failed += 1
            print(f"[薪资补录跳过] guopin job_id={job_id}: {exc}", file=sys.stderr)
        time.sleep(0.12)

    print(
        "历史国聘岗位薪资回填完成："
        f"列表更新 {updated} 条，详情更新 {detail_updated} 条，详情失败 {detail_failed} 条"
    )


def main():
    client = get_client()

    recheck_existing_graduation_year(client)

    print("读取已入库的岗位（避免重复用大模型判断已经判过的岗位）…")
    existing = client.table("jobs").select("raw_key").execute()
    seen_keys = {r["raw_key"] for r in existing.data}
    print(f"  已有 {len(seen_keys)} 条")

    rows = []

    print("抓取国聘校招岗位…")
    jobs = guopin.fetch_all_campus_jobs()
    backfill_guopin_salaries(client, jobs)
    new_jobs = [j for j in jobs if f"guopin:{j['job_id']}" not in seen_keys]
    print(f"共抓到 {len(jobs)} 条，其中新岗位 {len(new_jobs)} 条，开始逐条判断是否符合报名条件…")
    for i, job in enumerate(new_jobs, 1):
        try:
            rows.append(build_row_guopin(job))
        except Exception as e:
            print(f"[跳过] guopin job_id={job.get('job_id')} 处理失败: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  已处理 {i}/{len(new_jobs)}")

    run_freeform_source("sasac", sasac.fetch_list, sasac.fetch_detail, seen_keys, rows, "国资委官网人事招聘公告")
    run_freeform_source("eximbank", eximbank.fetch_list, eximbank.fetch_detail, seen_keys, rows, "进出口银行人才招聘公告")

    eligible_count = sum(1 for r in rows if r["eligible"])
    print(f"新增数据中可报名 {eligible_count} 条，写入 Supabase（含不符合的岗位，仅用于避免重复判断，前端只展示可报名的）…")

    upsert_jobs(client, rows)
    print("完成。")


if __name__ == "__main__":
    main()

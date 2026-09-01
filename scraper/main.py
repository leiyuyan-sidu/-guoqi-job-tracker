import sys
import time
from collections import defaultdict

import llm_match
from db import fetch_all, get_client, upsert_jobs
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


def fetch_with_retry(fetch_fn, label, attempts=3, backoff_sec=5):
    """重试包装。国资委、进出口银行官网从 GitHub 的海外机器访问经常读超时，
    一次失败就放弃太浪费，这里退避重试几次。"""
    for attempt in range(1, attempts + 1):
        try:
            return fetch_fn()
        except Exception as e:
            if attempt == attempts:
                raise
            wait = backoff_sec * attempt
            print(f"  {label}第 {attempt} 次失败（{e}），{wait} 秒后重试…", file=sys.stderr)
            time.sleep(wait)


def run_freeform_source(source, fetch_list_fn, fetch_detail_fn, seen_keys, label):
    """抓取一个无结构公告数据源，返回收集到的行。

    列表抓取失败只放弃这一个数据源并返回空列表，不能让整次任务崩掉——
    否则其他数据源已经花掉的大模型调用会一起丢失。
    """
    print(f"抓取{label}…")
    rows = []
    try:
        items = fetch_with_retry(fetch_list_fn, f"{label}列表抓取")
    except Exception as e:
        print(f"[跳过数据源] {label}列表抓取失败，本次不处理该来源: {e}", file=sys.stderr)
        return rows

    new_items = [it for it in items if f"{source}:{it['url']}" not in seen_keys]
    print(f"共抓到 {len(items)} 条校招相关公告，其中新公告 {len(new_items)} 条，开始逐条判断…")
    for i, item in enumerate(new_items, 1):
        try:
            rows.append(build_row_freeform(source, item, fetch_detail_fn))
        except Exception as e:
            print(f"[跳过] {source} url={item.get('url')} 处理失败: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  已处理 {i}/{len(new_items)}")
    return rows


def recheck_existing_graduation_year(client):
    """把历史库中明确只面向其他届别的岗位移出前端，避免规则只对新增数据生效。"""
    rows = fetch_all(
        lambda: client.table("jobs").select("id,title,description").eq("eligible", True)
    )
    excluded = 0
    for row in rows:
        cohort_ok, reason = check_graduation_year(
            PROFILE["graduation_year"], row.get("title"), row.get("description")
        )
        if cohort_ok is False:
            client.table("jobs").update(
                {"eligible": False, "eligible_reason": reason}
            ).eq("id", row["id"]).execute()
            excluded += 1
    print(f"历史岗位届别复核完成：排除 {excluded} 条不面向{PROFILE['graduation_year']}届的岗位")


def apply_salary_updates(client, updates):
    """把 {raw_key: 薪资文本} 写回数据库。

    薪资文本的取值很集中（大部分是「面议」），按取值分组后能把几千条更新
    压缩成几十次请求；分批是因为 raw_key 会拼进 URL，一次塞太多会超长。
    """
    by_salary = defaultdict(list)
    for raw_key, salary in updates.items():
        by_salary[salary].append(raw_key)

    for salary, keys in by_salary.items():
        for start in range(0, len(keys), 100):
            client.table("jobs").update({"salary": salary}).in_(
                "raw_key", keys[start : start + 100]
            ).execute()


def backfill_guopin_salaries(client, jobs):
    """为已有国聘岗位补薪资；推荐列表缺失时再按岗位 ID 查询详情。"""
    try:
        missing = fetch_all(
            lambda: client.table("jobs")
            .select("raw_key")
            .eq("source", "guopin")
            .is_("salary", "null")
        )
    except Exception:
        print("数据库尚未增加 salary 列，暂时跳过历史薪资回填")
        return

    missing_keys = {row["raw_key"] for row in missing}
    if not missing_keys:
        print("历史国聘岗位薪资已齐全，无需回填")
        return
    print(f"待回填薪资的国聘岗位 {len(missing_keys)} 条")

    # 当天的推荐列表本身就带薪资字段，先用它覆盖一批，省掉同样数量的详情请求。
    from_list = {}
    for job in jobs:
        raw_key = f"guopin:{job['job_id']}"
        salary = format_guopin_salary(job)
        if raw_key in missing_keys and salary:
            from_list[raw_key] = salary
    apply_salary_updates(client, from_list)
    missing_keys -= from_list.keys()

    # 推荐列表会随排序和岗位状态变化，仍缺失的历史岗位必须走详情接口。
    # 从海外机器逐条打国内接口很慢（首次积压几千条要跑近一小时），
    # 所以边跑边分批写库，中途被取消也不会前功尽弃。
    pending = {}
    detail_done = 0
    detail_failed = 0
    remaining = sorted(missing_keys)
    for i, raw_key in enumerate(remaining, 1):
        job_id = raw_key.removeprefix("guopin:")
        try:
            salary = format_guopin_salary(guopin.fetch_job_detail(job_id))
            if salary:
                pending[raw_key] = salary
        except Exception as exc:
            detail_failed += 1
            print(f"[薪资补录跳过] guopin job_id={job_id}: {exc}", file=sys.stderr)
        if len(pending) >= 500:
            apply_salary_updates(client, pending)
            detail_done += len(pending)
            pending = {}
        if i % 200 == 0:
            print(f"  详情补录进度 {i}/{len(remaining)}（已写入 {detail_done} 条）")
        time.sleep(0.12)
    apply_salary_updates(client, pending)
    detail_done += len(pending)

    print(
        "历史国聘岗位薪资回填完成："
        f"列表更新 {len(from_list)} 条，详情更新 {detail_done} 条，详情失败 {detail_failed} 条"
    )


def commit_rows(client, rows, label):
    """把一个数据源的结果立刻写库。

    分数据源写入而不是最后一次性 upsert：后面的数据源出错时，前面已经花掉
    大模型调用换来的判断结果不会跟着丢掉。
    """
    if not rows:
        print(f"{label}：无新增岗位")
        return
    eligible_count = sum(1 for r in rows if r["eligible"])
    upsert_jobs(client, rows)
    print(f"{label}：写入 {len(rows)} 条，其中可报名 {eligible_count} 条")


def run_guopin_source(client, seen_keys):
    """返回国聘新增岗位的行。顺带完成历史薪资回填。"""
    print("抓取国聘校招岗位…")
    try:
        jobs = fetch_with_retry(guopin.fetch_all_campus_jobs, "国聘岗位列表抓取")
    except Exception as e:
        print(f"[跳过数据源] 国聘岗位列表抓取失败，本次不处理该来源: {e}", file=sys.stderr)
        return []

    backfill_guopin_salaries(client, jobs)

    new_jobs = [j for j in jobs if f"guopin:{j['job_id']}" not in seen_keys]
    print(f"共抓到 {len(jobs)} 条，其中新岗位 {len(new_jobs)} 条，开始逐条判断是否符合报名条件…")
    rows = []
    for i, job in enumerate(new_jobs, 1):
        try:
            rows.append(build_row_guopin(job))
        except Exception as e:
            print(f"[跳过] guopin job_id={job.get('job_id')} 处理失败: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  已处理 {i}/{len(new_jobs)}")
    return rows


def main():
    client = get_client()

    recheck_existing_graduation_year(client)

    print("读取已入库的岗位（避免重复用大模型判断已经判过的岗位）…")
    existing = fetch_all(lambda: client.table("jobs").select("raw_key"))
    seen_keys = {r["raw_key"] for r in existing}
    print(f"  已有 {len(seen_keys)} 条")

    commit_rows(client, run_guopin_source(client, seen_keys), "国聘")

    commit_rows(
        client,
        run_freeform_source(
            "sasac", sasac.fetch_list, sasac.fetch_detail, seen_keys, "国资委官网人事招聘公告"
        ),
        "国资委",
    )
    commit_rows(
        client,
        run_freeform_source(
            "eximbank", eximbank.fetch_list, eximbank.fetch_detail, seen_keys, "进出口银行人才招聘公告"
        ),
        "进出口银行",
    )

    print("完成。")


if __name__ == "__main__":
    main()

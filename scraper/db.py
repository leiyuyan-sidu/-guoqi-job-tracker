import os

from supabase import create_client


def get_client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


def upsert_jobs(client, rows):
    if not rows:
        return
    try:
        client.table("jobs").upsert(rows, on_conflict="raw_key").execute()
    except Exception as error:
        # 部署代码早于数据库迁移时保持每日任务可运行；加列后会自动写入薪资。
        if "salary" not in str(error).lower():
            raise
        compatible_rows = [{key: value for key, value in row.items() if key != "salary"} for row in rows]
        client.table("jobs").upsert(compatible_rows, on_conflict="raw_key").execute()

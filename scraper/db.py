import os

from supabase import create_client

# Supabase/PostgREST 单次查询默认最多返回 1000 行，超出的部分会被静默截断，
# 所以凡是要读全表的地方都必须显式翻页，见 fetch_all。
PAGE_SIZE = 1000


def get_client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


def fetch_all(build_query, order_column="raw_key"):
    """按页读完一个查询的全部结果。

    build_query 是一个返回新查询对象的函数（每页都要重新构建，查询对象不能复用）。
    翻页必须配合稳定排序，否则页与页之间的顺序可能变化，导致漏行或重复。
    """
    rows = []
    offset = 0
    while True:
        page = (
            build_query()
            .order(order_column)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
            .data
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


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

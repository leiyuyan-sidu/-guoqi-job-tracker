import os

from supabase import create_client


def get_client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


def upsert_jobs(client, rows):
    if not rows:
        return
    client.table("jobs").upsert(rows, on_conflict="raw_key").execute()

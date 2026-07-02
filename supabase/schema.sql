create extension if not exists pgcrypto;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  raw_key text unique not null,
  source text not null,
  company text not null,
  title text not null,
  location text,
  education text,
  major_requirement text,
  description text,
  eligible boolean not null default false,
  eligible_reason text,
  interest_tag text,
  posted_at timestamptz,
  deadline timestamptz,
  url text not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_eligible_created on jobs (eligible, created_at desc);
create index if not exists idx_jobs_status on jobs (status);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_jobs_updated_at on jobs;
create trigger trg_jobs_updated_at
before update on jobs
for each row execute function set_updated_at();

alter table jobs enable row level security;

-- 任何人（包括未登录访客）可以只读浏览可报名岗位
drop policy if exists "public read" on jobs;
create policy "public read" on jobs
  for select using (true);

-- 只有登录用户（你自己）能更新投递状态；抓取脚本用 service_role key 写入，天然绕过 RLS
drop policy if exists "authenticated update status" on jobs;
create policy "authenticated update status" on jobs
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

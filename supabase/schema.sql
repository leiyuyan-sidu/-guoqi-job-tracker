create extension if not exists pgcrypto;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  raw_key text unique not null,
  source text not null,
  company text not null,
  title text not null,
  location text,
  salary text,
  education text,
  major_requirement text,
  description text,
  eligible boolean not null default false,
  eligible_reason text,
  interest_tag text,
  posted_at timestamptz,
  deadline timestamptz,
  url text not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'skipped', 'undecided')),
  status_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 兼容已经创建过 jobs 表的项目
alter table jobs add column if not exists salary text;

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
-- 投递进度管理：记录已投递岗位在各阶段的进展事件
--
-- 用事件流而不是在 jobs 上加单个 stage 字段，是为了能回答「投了多久没动静」
-- 和支持多轮面试；happened_on 允许填未来日期，用于笔试/面试的日程提醒。

create table if not exists application_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  stage       text not null check (stage in
                ('applied', 'resume_passed', 'written_test', 'interview', 'offer', 'rejected')),
  happened_on date not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_app_events_job on application_events (job_id, happened_on desc);

alter table application_events enable row level security;

-- 与 jobs 一致：任何人可读，只有登录用户能改
drop policy if exists "public read" on application_events;
create policy "public read" on application_events
  for select using (true);

drop policy if exists "authenticated write" on application_events;
create policy "authenticated write" on application_events
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

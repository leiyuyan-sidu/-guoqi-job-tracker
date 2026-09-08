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

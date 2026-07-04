-- 在已有的 jobs 表基础上，新增"待定"状态和处理原因字段
alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('pending', 'applied', 'skipped', 'undecided'));

alter table jobs add column if not exists status_note text;

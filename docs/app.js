import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.SUPABASE_CONFIG;
if (!cfg || cfg.url.includes("YOUR-PROJECT-REF")) {
  document.getElementById("job-list").innerHTML =
    '<div class="empty"><p class="empty-title">还没有配置 Supabase</p><p class="empty-subtitle text-secondary">复制 docs/config.example.js 为 docs/config.js 并填入你的项目信息。</p></div>';
  throw new Error("Supabase config missing");
}

const supabase = createClient(cfg.url, cfg.anonKey);

const $ = (id) => document.getElementById(id);

const jobListEl = $("job-list");
const listCardEl = $("list-card");
const listFooterEl = $("list-footer");
const listSummaryEl = $("list-summary");
const paginationEl = $("pagination");
const chipRowEl = $("bucket-chips");
const bucketTitleEl = $("bucket-title");
const upcomingCardEl = $("upcoming-card");
const upcomingListEl = $("upcoming-list");
const updatedHintEl = $("updated-hint");
const authBarEl = $("auth-bar");
const sourceFilterEl = $("filter-source");
const dateFilterEl = $("filter-date");
const searchEl = $("filter-search");

const statNewEl = $("stat-new");
const statTotalEl = $("stat-total");
const statTotalSubEl = $("stat-total-sub");
const statPendingEl = $("stat-pending");
const statPendingSubEl = $("stat-pending-sub");
const statPendingRatioEl = $("stat-pending-ratio");
const statPendingBarEl = $("stat-pending-bar");
const statAppliedEl = $("stat-applied");
const statAppliedSubEl = $("stat-applied-sub");
const statUrgentEl = $("stat-urgent");
const statUrgentSubEl = $("stat-urgent-sub");

const loginDialog = $("login-dialog");
const loginForm = $("login-form");
const loginError = $("login-error");
const undecidedDialog = $("undecided-dialog");
const undecidedForm = $("undecided-form");
const undecidedOtherReasonEl = $("undecided-other-reason");
const skipDialog = $("skip-dialog");
const skipForm = $("skip-form");
const skipOtherReasonEl = $("skip-other-reason");
const progressDialog = $("progress-dialog");
const progressForm = $("progress-form");
const progressSubjectEl = $("progress-subject");
const progressDateEl = $("progress-date");
const progressNoteEl = $("progress-note");
const progressErrorEl = $("progress-error");

const tabPendingBtn = $("tab-pending");
const tabProgressBtn = $("tab-progress");
const tabResolvedBtn = $("tab-resolved");
const tabPendingCountEl = $("tab-pending-count");
const tabProgressCountEl = $("tab-progress-count");
const tabResolvedCountEl = $("tab-resolved-count");

const batchToggleBtn = $("batch-toggle");
const batchBarEl = $("batch-bar");
const batchCountEl = $("batch-count");
const undoToastEl = $("undo-toast");
const undoTextEl = $("undo-text");
const undoBtnEl = $("undo-btn");

const PAGE_SIZE = 10;
const JOB_CACHE_KEY = "guoqi-job-tracker:jobs:v1";
const EVENT_CACHE_KEY = "guoqi-job-tracker:events:v1";
const JOB_FIELDS = [
  "id", "source", "company", "title", "location", "education",
  "major_requirement", "eligible_reason", "interest_tag", "posted_at",
  "deadline", "url", "status", "status_note", "created_at", "updated_at"
].join(",");

let session = null;
let allJobs = [];
let jobsLoading = true;
let jobsLoadError = null;
let currentTab = "pending";
let undecidedTargetJob = null;
let skipTargetJob = null;
let pendingBucket = "all";
let resolvedGroup = "all";
let progressGroup = "all";
let currentPage = 1;
let expandedReasons = new Set();
let expandedTimelines = new Set();
let eventsByJob = new Map();
let eventsLoaded = false;
let progressTargetJob = null;
let listNeedsEntranceAnimation = true;
let batchMode = false;
let selectedIds = new Set();
let batchReasonStatus = null;
let currentFiltered = [];
let currentPageItems = [];
let undoTimer = null;

const BATCH_WRITE_SIZE = 100;
const BATCH_CONFIRM_THRESHOLD = 50;
const UNDO_WINDOW_MS = 10000;
// 行级权限拦下的 UPDATE 不会报错，只会悄悄更新 0 行（最常见的是登录过期），要当成失败处理。
const NO_ROWS_UPDATED = { message: "没有更新到任何数据，登录可能已过期，请重新登录" };

const STATUS_LABELS = {
  applied: "已投递",
  skipped: "不投递",
  undecided: "待定",
};

const STATUS_BADGE = {
  skipped: "bg-red-lt",
  undecided: "bg-yellow-lt",
};

const SOURCE_LABELS = {
  guopin: "国聘",
  sasac: "国资委",
  eximbank: "进出口银行",
};

const SOURCE_AVATAR = {
  guopin: "bg-blue-lt",
  sasac: "bg-red-lt",
  eximbank: "bg-green-lt",
};

const DEADLINE_BUCKETS = [
  { key: "week1", label: "一周内截止" },
  { key: "week2", label: "两周内截止" },
  { key: "month1", label: "一个月内截止" },
  { key: "monthplus", label: "一个月以上" },
  { key: "none", label: "未注明截止日期" },
  { key: "expired", label: "已截止" },
];

// 已投递岗位改由「投递进度」Tab 跟进，已处理记录只留决策归档。
const RESOLVED_GROUPS = [
  { key: "skipped", label: "不投递" },
  { key: "undecided", label: "待定" },
];

const STAGES = [
  { key: "applied", label: "已投递" },
  { key: "resume_passed", label: "简历通过" },
  { key: "written_test", label: "笔试" },
  { key: "interview", label: "面试" },
  { key: "offer", label: "Offer" },
  { key: "rejected", label: "未通过" },
];

const STAGE_LABELS = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

const STAGE_BADGE = {
  applied: "bg-blue-lt",
  resume_passed: "bg-cyan-lt",
  written_test: "bg-indigo-lt",
  interview: "bg-orange-lt",
  offer: "bg-green-lt",
  rejected: "bg-secondary-lt",
  closed: "bg-secondary-lt",
};

const STAGE_ICON = {
  applied: "ti-send",
  resume_passed: "ti-file-check",
  written_test: "ti-pencil",
  interview: "ti-users",
  offer: "ti-trophy",
  rejected: "ti-x",
};

// 分组用的当前阶段：记过「未通过」就归入已结束，不再占据活跃列表。
const PROGRESS_GROUPS = [
  ...STAGES.filter((s) => s.key !== "rejected"),
  { key: "closed", label: "已结束" },
];

const BUCKET_TITLES = {
  pending: "截止时间",
  progress: "当前阶段",
  resolved: "处理结果",
};

const BUCKET_ICONS = {
  week1: '<i class="ti ti-alarm text-red me-2"></i>',
  week2: '<i class="ti ti-clock text-orange me-2"></i>',
  expired: '<i class="ti ti-archive me-2"></i>',
};

const UPCOMING_DAYS = 7;

const SKIP_REASON_CATEGORIES = ["工资太低", "地区不合适", "工作内容不喜欢", "专业不符合"];
const UNDECIDED_REASON_CATEGORIES = ["工资一般", "地区一般", "专业不太符合"];

function toLocalDateStr(d) {
  if (!d) return "";
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function deadlineBucket(deadline) {
  if (!deadline) return "none";
  const diffDays = (new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "expired";
  if (diffDays <= 7) return "week1";
  if (diffDays <= 14) return "week2";
  if (diffDays <= 30) return "month1";
  return "monthplus";
}

function todayStr() {
  return toLocalDateStr(new Date());
}

/** 相对今天的天数差；正数表示还有几天，负数表示已过去几天。 */
function daysFromToday(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date(todayStr() + "T00:00:00");
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function jobEvents(job) {
  return eventsByJob.get(job.id) || [];
}

/** 事件按时间先后排序：日期为主，同日按记录时间兜底。 */
function sortedEvents(job) {
  return [...jobEvents(job)].sort(
    (a, b) =>
      a.happened_on.localeCompare(b.happened_on) ||
      (a.created_at || "").localeCompare(b.created_at || "")
  );
}

function latestEvent(job) {
  const events = sortedEvents(job);
  return events.length ? events[events.length - 1] : null;
}

/**
 * 当前阶段。按 happened_on 取最新而不是 created_at，这样今天登记「9/15 笔试」
 * 之后当前阶段立刻变成笔试，不用等到那天。
 */
function jobStage(job) {
  const events = jobEvents(job);
  if (events.some((e) => e.stage === "rejected")) return "closed";
  const latest = latestEvent(job);
  return latest ? latest.stage : "applied";
}

/** 最近一个尚未到来的日程，用于「还有 N 天」提示。 */
function nextSchedule(job) {
  return sortedEvents(job).find((e) => daysFromToday(e.happened_on) > 0) || null;
}

/** 当前阶段已经停留了多少天，用来识别投出去之后没动静的岗位。 */
function daysInCurrentStage(job) {
  const latest = latestEvent(job);
  if (!latest) return null;
  const diff = daysFromToday(latest.happened_on);
  return diff > 0 ? null : -diff;
}

function shortDate(d) {
  const x = new Date(d);
  return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
}

function monthDay(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function isToday(d) {
  if (!d) return false;
  const dt = new Date(d);
  const now = new Date();
  return dt.toDateString() === now.toDateString();
}

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeDay(days) {
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  return `${days} 天后`;
}

async function refreshAuthUI() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) {
    authBarEl.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <span class="avatar avatar-sm"><i class="ti ti-user"></i></span>
        <span class="small d-none d-lg-inline">${escapeHtml(session.user.email)}</span>
        <button type="button" class="btn btn-sm btn-ghost-secondary" id="logout-btn"><i class="ti ti-logout"></i>退出</button>
      </div>`;
    $("logout-btn").onclick = async () => {
      await supabase.auth.signOut();
      await refreshAuthUI();
    };
  } else {
    authBarEl.innerHTML = `<button type="button" class="btn btn-sm btn-primary" id="login-btn"><i class="ti ti-login"></i>登录后可标记</button>`;
    $("login-btn").onclick = () => {
      loginError.textContent = "";
      loginDialog.showModal();
    };
  }
  syncBatchAvailability();
  renderJobs();
  // 首屏加载和登录态解析是并行的，这里再补一次，确保登录后能补齐起点事件。
  backfillAppliedEvents();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = "登录失败：" + error.message;
    return;
  }
  loginDialog.close();
  loginForm.reset();
  await refreshAuthUI();
});

$("login-cancel").addEventListener("click", () => {
  loginDialog.close();
});

async function loadJobs() {
  jobsLoadError = null;
  const hasCachedJobs = restoreJobsCache();

  if (hasCachedJobs) {
    jobsLoading = false;
    populateSourceFilter();
    updateStats();
    renderJobs();
  } else {
    jobsLoading = true;
    renderJobs();
  }

  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_FIELDS)
    .eq("eligible", true)
    .order("created_at", { ascending: false });

  if (error) {
    if (hasCachedJobs) {
      updatedHintEl.textContent += " · 暂时无法更新，当前显示上次缓存";
    } else {
      jobsLoading = false;
      jobsLoadError = error.message;
      renderJobs();
    }
    return;
  }

  allJobs = data;
  jobsLoading = false;
  writeJobsCache();
  populateSourceFilter();
  updateStats();
  renderJobs();
  loadEvents();
  loadSalaries();
}

async function loadEvents() {
  const { data, error } = await supabase
    .from("application_events")
    .select("id,job_id,stage,happened_on,note,created_at");
  if (error || !data) return;

  indexEvents(data);
  eventsLoaded = true;
  writeEventsCache(data);
  updateStats();
  renderJobs();
  backfillAppliedEvents();
}

/**
 * 补齐缺失的投递起点事件。
 *
 * 两种情况会出现「已投递却没有任何事件」：本功能上线之前就标记过的岗位，
 * 以及改状态成功、但紧接着的事件写入没跑完（两者是独立请求）。
 * 投递日期取 updated_at，也就是当初点下「已投递」的那一刻。
 */
async function backfillAppliedEvents() {
  if (!session || !eventsLoaded) return;
  const missing = allJobs.filter((j) => j.status === "applied" && !jobEvents(j).length);
  if (!missing.length) return;

  const { data, error } = await supabase
    .from("application_events")
    .insert(
      missing.map((j) => ({
        job_id: j.id,
        stage: "applied",
        happened_on: toLocalDateStr(j.updated_at || j.created_at),
        note: null,
      }))
    )
    .select();
  if (error || !data) return;

  for (const row of data) {
    if (!eventsByJob.has(row.job_id)) eventsByJob.set(row.job_id, []);
    eventsByJob.get(row.job_id).push(row);
  }
  writeEventsCache();
  renderJobs();
}

function indexEvents(rows) {
  eventsByJob = new Map();
  for (const row of rows) {
    if (!eventsByJob.has(row.job_id)) eventsByJob.set(row.job_id, []);
    eventsByJob.get(row.job_id).push(row);
  }
}

function allEvents() {
  return [...eventsByJob.values()].flat();
}

async function loadSalaries() {
  const { data, error } = await supabase
    .from("jobs")
    .select("id,salary")
    .eq("eligible", true);
  if (error || !data) return;

  const salaries = new Map(data.map((row) => [row.id, row.salary]));
  for (const job of allJobs) job.salary = salaries.get(job.id) || null;
  writeJobsCache();
  renderJobs();
}

function restoreJobsCache() {
  try {
    const cachedEvents = JSON.parse(localStorage.getItem(EVENT_CACHE_KEY));
    if (Array.isArray(cachedEvents)) indexEvents(cachedEvents);
  } catch {
    // 进度缓存坏了不影响岗位列表，联网后会重新拉一份。
  }
  try {
    const cached = JSON.parse(localStorage.getItem(JOB_CACHE_KEY));
    if (!cached || !Array.isArray(cached.jobs)) return false;
    allJobs = cached.jobs;
    return true;
  } catch {
    return false;
  }
}

function writeEventsCache(rows) {
  try {
    localStorage.setItem(EVENT_CACHE_KEY, JSON.stringify(rows ?? allEvents()));
  } catch {
    // 浏览器禁用本地存储时跳过缓存，不影响功能。
  }
}

function writeJobsCache() {
  try {
    localStorage.setItem(JOB_CACHE_KEY, JSON.stringify({ jobs: allJobs, savedAt: Date.now() }));
  } catch {
    // 浏览器禁用本地存储或空间不足时，继续使用正常网络加载。
  }
}

function populateSourceFilter() {
  const current = sourceFilterEl.value;
  const sources = [...new Set(allJobs.map((j) => j.source))];
  sourceFilterEl.innerHTML =
    '<option value="">全部来源</option>' +
    sources.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(SOURCE_LABELS[s] || s)}</option>`).join("");
  if (sources.includes(current)) sourceFilterEl.value = current;
}

function updateStats() {
  // 「可报名」只算还能投的：已截止的岗位报不了名，不该计入。
  const openJobs = allJobs.filter((j) => !isExpired(j));
  const newToday = allJobs.filter((j) => isToday(j.created_at)).length;
  statTotalEl.textContent = openJobs.length;
  statTotalSubEl.textContent = `已剔除已截止 ${allJobs.length - openJobs.length} 个`;
  statNewEl.textContent = `+${newToday} 今日`;
  statNewEl.classList.toggle("hidden", newToday === 0);

  // 待处理数字对齐主列表：不含已截止，这样和各截止分桶的计数之和一致。
  const pendingOpen = allJobs.filter((j) => j.status === "pending" && !isExpired(j));
  const applied = allJobs.filter((j) => j.status === "applied");
  const resolvedCount = allJobs.filter((j) => j.status !== "pending" && j.status !== "applied").length;
  const handled = applied.length + resolvedCount;
  const ratio = handled + pendingOpen.length ? Math.round((handled / (handled + pendingOpen.length)) * 100) : 0;
  statPendingEl.textContent = pendingOpen.length;
  statPendingSubEl.textContent = `已处理 ${handled} 个`;
  statPendingRatioEl.textContent = `${ratio}%`;
  statPendingBarEl.style.width = `${ratio}%`;

  const closedCount = applied.filter((j) => jobStage(j) === "closed").length;
  statAppliedEl.textContent = applied.length;
  statAppliedSubEl.textContent = `进行中 ${applied.length - closedCount} · 已结束 ${closedCount}`;

  const urgent = pendingOpen.filter((j) => ["week1", "week2"].includes(deadlineBucket(j.deadline)));
  const week1 = urgent.filter((j) => deadlineBucket(j.deadline) === "week1").length;
  statUrgentEl.textContent = urgent.length;
  statUrgentSubEl.textContent = `其中一周内 ${week1} 个`;

  const latest = allJobs.reduce((max, j) => (j.created_at > max ? j.created_at : max), "");
  updatedHintEl.textContent = latest ? `更新于 ${new Date(latest).toLocaleString("zh-CN")}` : "";

  tabPendingCountEl.textContent = pendingOpen.length;
  tabProgressCountEl.textContent = applied.length;
  tabResolvedCountEl.textContent = resolvedCount;
}

function jobBucketKey(job) {
  if (currentTab === "pending") return deadlineBucket(job.deadline);
  if (currentTab === "progress") return jobStage(job);
  return job.status;
}

function bucketOptions() {
  const groups =
    currentTab === "pending"
      ? DEADLINE_BUCKETS
      : currentTab === "progress"
        ? PROGRESS_GROUPS
        : RESOLVED_GROUPS;
  return [{ key: "all", label: "全部" }, ...groups];
}

function isExpired(job) {
  return deadlineBucket(job.deadline) === "expired";
}

function bucketFiltered(jobs, key) {
  if (key !== "all") return jobs.filter((j) => jobBucketKey(j) === key);
  // 已截止岗位仍算待处理，但默认不进主列表，需要时点最后那一项单独查看。
  if (currentTab === "pending") return jobs.filter((j) => !isExpired(j));
  return jobs;
}

function activeBucketKey() {
  if (currentTab === "pending") return pendingBucket;
  if (currentTab === "progress") return progressGroup;
  return resolvedGroup;
}

function setActiveBucketKey(key) {
  if (currentTab === "pending") pendingBucket = key;
  else if (currentTab === "progress") progressGroup = key;
  else resolvedGroup = key;
}

function renderBucketChips(baseFiltered) {
  const activeKey = activeBucketKey();
  bucketTitleEl.textContent = BUCKET_TITLES[currentTab];
  chipRowEl.innerHTML = bucketOptions()
    .map((opt) => {
      const count = bucketFiltered(baseFiltered, opt.key).length;
      const active = activeKey === opt.key;
      let badge = "";
      if (active) badge = "bg-primary-lt";
      else if (opt.key === "week1" && count) badge = "bg-red-lt";
      else if (opt.key === "week2" && count) badge = "bg-orange-lt";
      return `
        <a href="#" class="list-group-item list-group-item-action d-flex align-items-center${active ? " active" : ""}${opt.key === "expired" ? " bucket-expired" : ""}" data-bucket="${opt.key}">
          ${BUCKET_ICONS[opt.key] || ""}${opt.label}<span class="badge ${badge} ms-auto">${count}</span>
        </a>`;
    })
    .join("");
}

/** 页码过多时只显示首尾和当前页附近几页，中间用省略号代替。 */
function pageWindow(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

function renderPagination(totalPages) {
  if (totalPages <= 1) {
    paginationEl.innerHTML = "";
    return;
  }
  const item = (label, page, { disabled = false, active = false } = {}) =>
    `<li class="page-item${disabled ? " disabled" : ""}${active ? " active" : ""}">
       <a class="page-link" href="#" ${page ? `data-page="${page}"` : ""}>${label}</a>
     </li>`;
  paginationEl.innerHTML = [
    item('<i class="ti ti-chevron-left"></i>', currentPage - 1, { disabled: currentPage === 1 }),
    ...pageWindow(currentPage, totalPages).map((p) =>
      p === "…" ? item("…", null, { disabled: true }) : item(p, p, { active: p === currentPage })
    ),
    item('<i class="ti ti-chevron-right"></i>', currentPage + 1, { disabled: currentPage === totalPages }),
  ].join("");
}

function setFooter(text, totalPages = 1) {
  if (text === null) {
    listFooterEl.classList.add("hidden");
    paginationEl.innerHTML = "";
    return;
  }
  listFooterEl.classList.remove("hidden");
  listSummaryEl.textContent = text;
  renderPagination(totalPages);
}

function emptyState(icon, title, subtitle = "") {
  return `
    <div class="empty">
      <div class="empty-icon"><i class="ti ${icon}"></i></div>
      <p class="empty-title">${title}</p>
      ${subtitle ? `<p class="empty-subtitle text-secondary">${subtitle}</p>` : ""}
    </div>`;
}

function renderJobs() {
  renderUpcoming();

  if (jobsLoading) {
    renderLoadingSkeleton();
    return;
  }
  if (jobsLoadError) {
    jobListEl.innerHTML = emptyState("ti-cloud-off", "岗位加载失败，请刷新重试", escapeHtml(jobsLoadError));
    chipRowEl.innerHTML = "";
    setFooter(null);
    return;
  }

  const sourceVal = sourceFilterEl.value;
  const dateVal = dateFilterEl.value;
  const q = searchEl.value.trim().toLowerCase();

  const baseFiltered = allJobs.filter((j) => {
    if (sourceVal && j.source !== sourceVal) return false;
    if (q && !(j.company.toLowerCase().includes(q) || j.title.toLowerCase().includes(q))) return false;
    if (dateVal) {
      const relevantDate = currentTab === "pending" ? j.created_at : j.updated_at;
      if (toLocalDateStr(relevantDate) !== dateVal) return false;
    }
    if (currentTab === "pending") return j.status === "pending";
    if (currentTab === "progress") return j.status === "applied";
    return j.status !== "pending" && j.status !== "applied";
  });

  renderBucketChips(baseFiltered);

  const bucketKey = activeBucketKey();
  let finalFiltered = bucketFiltered(baseFiltered, bucketKey);

  if (currentTab === "resolved") {
    finalFiltered = [...finalFiltered].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }

  if (currentTab === "progress") {
    finalFiltered = sortByUrgency(finalFiltered);
  }

  // 批量「全选筛选结果」要用到当前筛选出的完整集合，不只是本页。
  currentFiltered = finalFiltered;
  currentPageItems = [];

  if (finalFiltered.length === 0) {
    const hasActiveFilters = Boolean(sourceVal || dateVal || q || bucketKey !== "all");
    if (currentTab === "progress" && !hasActiveFilters) {
      jobListEl.innerHTML = emptyState(
        "ti-send",
        "还没有投递中的岗位",
        "在「待处理」里点「投递」后，岗位会出现在这里，可以逐步记录简历通过、笔试、面试到 Offer 的进展。"
      );
    } else if (currentTab === "pending" && !hasActiveFilters && allJobs.length === 0) {
      jobListEl.innerHTML = emptyState(
        "ti-circle-check",
        "岗位信息已加载完成",
        "暂未发现符合 2027 届报名条件的岗位，系统会在每日更新后自动补充。"
      );
    } else {
      const text =
        currentTab === "pending"
          ? "当前筛选条件下没有待处理岗位"
          : currentTab === "progress"
            ? "当前筛选条件下没有投递中的岗位"
            : "还没有符合条件的已处理岗位";
      jobListEl.innerHTML = emptyState("ti-mood-empty", text);
    }
    setFooter(null);
    return;
  }

  if (currentTab === "resolved" && bucketKey === "skipped") {
    renderReasonGroups(finalFiltered, SKIP_REASON_CATEGORIES);
    return;
  }
  if (currentTab === "resolved" && bucketKey === "undecided") {
    renderReasonGroups(finalFiltered, UNDECIDED_REASON_CATEGORIES);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(finalFiltered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = finalFiltered.slice(start, start + PAGE_SIZE);
  currentPageItems = pageItems;

  jobListEl.innerHTML =
    currentTab === "pending"
      ? pendingTable(pageItems)
      : currentTab === "progress"
        ? progressTable(pageItems)
        : resolvedTable(pageItems);

  if (listNeedsEntranceAnimation) {
    jobListEl.classList.remove("list-enter");
    void jobListEl.offsetWidth;
    jobListEl.classList.add("list-enter");
    listNeedsEntranceAnimation = false;
  }

  setFooter(`第 ${start + 1}–${start + pageItems.length} 条，共 ${finalFiltered.length} 条`, totalPages);
}

function scrollToListStart() {
  const top = window.scrollY + listCardEl.getBoundingClientRect().top - 12;
  if (top < window.scrollY) window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function renderLoadingSkeleton() {
  updatedHintEl.textContent = "正在连接招聘信息库…";
  chipRowEl.innerHTML = "";
  setFooter(null);
  jobListEl.innerHTML = `
    <div class="card-body placeholder-glow">
      ${[0, 1, 2, 3, 4].map((i) => `
        <div class="d-flex align-items-center mb-4">
          <span class="avatar placeholder me-3"></span>
          <div class="flex-fill">
            <div class="placeholder col-${[5, 4, 6, 3, 5][i]} mb-2"></div>
            <div class="placeholder col-${[8, 7, 9, 6, 8][i]}"></div>
          </div>
        </div>`).join("")}
    </div>`;
}

/* ---------- 各页签的表格 ---------- */

function companyCell(job, extraBadges = "", subline = "") {
  return `
    <td class="job-cell">
      <div class="d-flex py-1 align-items-start">
        <span class="avatar avatar-sm me-3 mt-1 ${SOURCE_AVATAR[job.source] || "bg-secondary-lt"}" title="${escapeAttr(SOURCE_LABELS[job.source] || job.source)}">${escapeHtml(job.company.slice(0, 2))}</span>
        <div class="flex-fill">
          <div class="font-weight-medium">${escapeHtml(job.company)}${extraBadges}</div>
          <div class="text-secondary">${escapeHtml(job.title)}${job.location ? " · " + escapeHtml(job.location) : ""}</div>
          ${subline}
        </div>
      </div>
    </td>`;
}

function deadlineCell(job) {
  if (!job.deadline) return '<span class="text-secondary">未注明</span>';
  const days = daysFromToday(toLocalDateStr(job.deadline));
  const date = shortDate(job.deadline);
  if (days < 0) return `<span class="badge bg-secondary-lt">已截止</span><div class="text-secondary small mt-1">${date}</div>`;
  if (days <= 7) return `<span class="badge bg-red-lt">${days === 0 ? "今天截止" : `还剩 ${days} 天`}</span><div class="text-secondary small mt-1">${date}</div>`;
  if (days <= 14) return `<span class="badge bg-orange-lt">还剩 ${days} 天</span><div class="text-secondary small mt-1">${date}</div>`;
  return `<div>${date}</div><div class="text-secondary small">${days} 天后</div>`;
}

function linkButton(job) {
  return `<a class="btn btn-sm btn-icon btn-ghost-secondary" href="${escapeAttr(job.url)}" target="_blank" rel="noopener" title="查看原始公告"><i class="ti ti-external-link"></i></a>`;
}

function lockAttr() {
  return session ? "" : 'disabled title="登录后才能标记"';
}

function pendingTable(jobs) {
  return `
    <div class="table-responsive">
      <table class="table table-vcenter card-table table-hover">
        <thead>
          <tr>
            ${batchMode ? '<th class="w-1"></th>' : ""}
            <th>单位 / 岗位</th>
            <th>专业要求</th>
            <th>学历 · 薪资</th>
            <th>截止</th>
            <th class="w-1"></th>
          </tr>
        </thead>
        <tbody>${jobs.map(pendingRow).join("")}</tbody>
      </table>
    </div>`;
}

function pendingRow(job) {
  const notInterested = !!job.interest_tag;
  const selected = batchMode && selectedIds.has(job.id);
  const badges =
    (isToday(job.created_at) ? '<span class="badge bg-green-lt ms-2">今日新增</span>' : "") +
    (notInterested ? '<span class="badge bg-secondary-lt ms-2">不感兴趣</span>' : "");
  const clue = job.eligible_reason
    ? `<div class="text-secondary small mt-1 clue"><i class="ti ti-sparkles text-yellow"></i> ${escapeHtml(job.eligible_reason)}</div>`
    : "";
  const salary = job.salary || "薪资未注明";
  return `
    <tr class="job-row${notInterested || isExpired(job) ? " muted" : ""}${selected ? " selected" : ""}" data-job-id="${job.id}">
      ${batchMode ? `<td><input class="form-check-input m-0 align-middle batch-check" type="checkbox" ${selected ? "checked" : ""} aria-label="选择该岗位"></td>` : ""}
      ${companyCell(job, badges, clue)}
      <td class="text-secondary small major-cell">${escapeHtml(job.major_requirement || "详见职位描述")}</td>
      <td>
        <div>${escapeHtml(job.education || "—")}</div>
        <div class="text-secondary small salary" title="${escapeAttr(salary)}">${escapeHtml(salary)}</div>
      </td>
      <td>${deadlineCell(job)}</td>
      <td class="text-end">
        <div class="btn-list flex-nowrap justify-content-end">
          ${linkButton(job)}
          ${batchMode ? "" : `
            <button type="button" class="btn btn-sm btn-outline-success act-apply" data-action="apply" ${lockAttr()}><i class="ti ti-send"></i>投递</button>
            <button type="button" class="btn btn-sm btn-icon btn-ghost-warning" data-action="undecided" title="标记待定" ${lockAttr()}><i class="ti ti-help-circle"></i></button>
            <button type="button" class="btn btn-sm btn-icon btn-ghost-danger" data-action="skip" title="标记不投递" ${lockAttr()}><i class="ti ti-x"></i></button>`}
        </div>
      </td>
    </tr>`;
}

function progressTable(jobs) {
  return `
    <div class="table-responsive">
      <table class="table table-vcenter card-table table-hover">
        <thead>
          <tr>
            <th>单位 / 岗位</th>
            <th>当前阶段</th>
            <th>下一个日程</th>
            <th class="w-1"></th>
          </tr>
        </thead>
        <tbody>${jobs.map(progressRow).join("")}</tbody>
      </table>
    </div>`;
}

function progressRow(job) {
  const stage = jobStage(job);
  const closed = stage === "closed";
  const events = sortedEvents(job);
  const upcoming = nextSchedule(job);
  const stalled = daysInCurrentStage(job);
  const isOpen = expandedTimelines.has(job.id);

  const stalledText =
    stalled === null ? "" : stalled === 0 ? "今天更新" : `已停留 ${stalled} 天`;
  // 两周没动静就该去催了，标红提醒
  const stalledCls = stalled >= 14 && !closed ? "text-red" : "text-secondary";
  const next = upcoming
    ? `<div>${monthDay(upcoming.happened_on)} · ${STAGE_LABELS[upcoming.stage]}${upcoming.note ? `（${escapeHtml(upcoming.note)}）` : ""}</div>
       <div class="text-primary small">${relativeDay(daysFromToday(upcoming.happened_on))}</div>`
    : '<span class="text-secondary">—</span>';

  return `
    <tr class="job-row${closed ? " muted" : ""}" data-job-id="${job.id}">
      ${companyCell(job)}
      <td>
        <span class="badge ${STAGE_BADGE[stage] || ""}">${closed ? "已结束" : STAGE_LABELS[stage] || stage}</span>
        ${stalledText ? `<div class="small mt-1 ${stalledCls}">${stalledText}</div>` : ""}
      </td>
      <td>${next}</td>
      <td class="text-end">
        <div class="btn-list flex-nowrap justify-content-end">
          ${linkButton(job)}
          <button type="button" class="btn btn-sm btn-ghost-secondary" data-action="timeline"><i class="ti ti-chevron-${isOpen ? "down" : "right"}"></i>时间线 ${events.length}</button>
          <button type="button" class="btn btn-sm btn-outline-primary" data-action="add-event" ${lockAttr()}><i class="ti ti-plus"></i>记录进展</button>
          <button type="button" class="btn btn-sm btn-icon btn-ghost-secondary" data-action="revert" title="撤销投递，移回待处理" ${lockAttr()}><i class="ti ti-arrow-back-up"></i></button>
        </div>
      </td>
    </tr>
    ${isOpen ? `<tr class="timeline-row" data-job-id="${job.id}"><td colspan="4">${timelineHtml(events)}</td></tr>` : ""}`;
}

function timelineHtml(events) {
  if (!events.length) return '<span class="text-secondary small">还没有记录</span>';
  return `
    <ul class="list-unstyled mb-0 timeline-list">
      ${[...events].reverse().map((e) => {
        const future = daysFromToday(e.happened_on) > 0;
        return `
          <li class="d-flex align-items-center gap-2">
            <span class="status-dot ${future ? "status-dot-animated status-blue" : "status-secondary"}"></span>
            <span class="text-secondary timeline-date">${e.happened_on.slice(5)}</span>
            <span class="badge ${STAGE_BADGE[e.stage] || ""}">${STAGE_LABELS[e.stage] || e.stage}</span>
            ${e.note ? `<span class="text-secondary">${escapeHtml(e.note)}</span>` : ""}
            ${future ? '<span class="text-primary small">未到</span>' : ""}
            <button type="button" class="btn btn-sm btn-icon btn-ghost-danger ms-auto" data-action="del-event" data-event-id="${e.id}" title="删除这条记录" ${lockAttr()}><i class="ti ti-trash"></i></button>
          </li>`;
      }).join("")}
    </ul>`;
}

function resolvedTable(jobs, groupsHtml) {
  return `
    <div class="table-responsive">
      <table class="table table-vcenter card-table table-hover">
        <thead>
          <tr>
            <th>单位 / 岗位</th>
            <th>处理结果</th>
            <th>处理时间</th>
            <th class="w-1"></th>
          </tr>
        </thead>
        <tbody>${groupsHtml ?? jobs.map(resolvedRow).join("")}</tbody>
      </table>
    </div>`;
}

function resolvedRow(job) {
  return `
    <tr class="job-row" data-job-id="${job.id}">
      ${companyCell(job)}
      <td>
        <span class="badge ${STATUS_BADGE[job.status] || ""}">${STATUS_LABELS[job.status] || job.status}</span>
        ${job.status_note ? `<div class="text-secondary small mt-1">${escapeHtml(job.status_note)}</div>` : ""}
      </td>
      <td class="text-secondary small">${fmtDateTime(job.updated_at)}</td>
      <td class="text-end">
        <div class="btn-list flex-nowrap justify-content-end">
          ${linkButton(job)}
          <button type="button" class="btn btn-sm btn-icon btn-ghost-secondary" data-action="revert" title="撤销，移回待处理" ${lockAttr()}><i class="ti ti-arrow-back-up"></i></button>
        </div>
      </td>
    </tr>`;
}

/** 不投递 / 待定按原因分组，每组可折叠。 */
function renderReasonGroups(jobs, categories) {
  const groups = [...categories, "其他原因"].map((reason) => ({
    reason,
    items: jobs.filter((j) =>
      reason === "其他原因" ? !categories.includes(j.status_note) : j.status_note === reason
    ),
  }));

  const body = groups
    .map(({ reason, items }) => {
      const open = expandedReasons.has(reason);
      return `
        <tr class="group-row" data-action="toggle-reason" data-reason="${encodeURIComponent(reason)}">
          <td colspan="4">
            <i class="ti ti-chevron-${open ? "down" : "right"} text-secondary"></i>
            <strong class="ms-1">${escapeHtml(reason)}</strong>
            <span class="badge ms-2">${items.length}</span>
          </td>
        </tr>
        ${open ? (items.length ? items.map(resolvedRow).join("") : '<tr><td colspan="4" class="text-secondary small ps-5">暂无</td></tr>') : ""}`;
    })
    .join("");

  jobListEl.innerHTML = resolvedTable(jobs, body);
  setFooter(`共 ${jobs.length} 条，按原因分组`);
}

function renderUpcoming() {
  const items = [];
  for (const job of allJobs) {
    if (job.status !== "applied") continue;
    for (const event of jobEvents(job)) {
      const days = daysFromToday(event.happened_on);
      if (days >= 0 && days <= UPCOMING_DAYS) items.push({ job, event, days });
    }
  }
  upcomingCardEl.classList.toggle("hidden", items.length === 0);
  if (!items.length) return;

  items.sort((a, b) => a.days - b.days);
  upcomingListEl.innerHTML = items
    .slice(0, 6)
    .map(({ job, event, days }) => `
      <div class="list-group-item">
        <div class="row align-items-center g-2">
          <div class="col-auto"><span class="avatar avatar-sm ${STAGE_BADGE[event.stage] || ""}"><i class="ti ${STAGE_ICON[event.stage] || "ti-calendar"}"></i></span></div>
          <div class="col text-truncate">
            <div class="text-body text-truncate">${escapeHtml(job.company)} · ${STAGE_LABELS[event.stage]}${event.note ? `（${escapeHtml(event.note)}）` : ""}</div>
            <div class="text-secondary small">${monthDay(event.happened_on)} · ${relativeDay(days)}</div>
          </div>
        </div>
      </div>`)
    .join("");
}

/**
 * 投递进度排序：有临近日程的排最前（按日期近的优先），
 * 其余按当前阶段停留时间由长到短——停得越久越需要你去催。
 * 已结束的沉到最后。
 */
function sortByUrgency(jobs) {
  return [...jobs].sort((a, b) => {
    const closedA = jobStage(a) === "closed";
    const closedB = jobStage(b) === "closed";
    if (closedA !== closedB) return closedA ? 1 : -1;

    const nextA = nextSchedule(a);
    const nextB = nextSchedule(b);
    if (nextA && nextB) return nextA.happened_on.localeCompare(nextB.happened_on);
    if (nextA) return -1;
    if (nextB) return 1;

    return (daysInCurrentStage(b) ?? -1) - (daysInCurrentStage(a) ?? -1);
  });
}

/* ---------- 列表里的点击统一在这里分发 ---------- */

function jobById(id) {
  return allJobs.find((j) => j.id === id);
}

jobListEl.addEventListener("click", (e) => {
  const actionEl = e.target.closest("[data-action]");
  const row = e.target.closest("[data-job-id]");
  const job = row ? jobById(row.dataset.jobId) : null;

  if (actionEl) {
    switch (actionEl.dataset.action) {
      case "apply": if (job) setStatus(job, "applied"); break;
      case "undecided": if (job) openUndecidedDialog(job); break;
      case "skip": if (job) openSkipDialog(job); break;
      case "revert": if (job) setStatus(job, "pending", null); break;
      case "add-event": if (job) openProgressDialog(job); break;
      case "del-event": if (job) deleteEvent(job, actionEl.dataset.eventId); break;
      case "timeline":
        if (job) {
          if (expandedTimelines.has(job.id)) expandedTimelines.delete(job.id);
          else expandedTimelines.add(job.id);
          renderJobs();
        }
        break;
      case "toggle-reason": {
        const reason = decodeURIComponent(actionEl.dataset.reason);
        if (expandedReasons.has(reason)) expandedReasons.delete(reason);
        else expandedReasons.add(reason);
        renderJobs();
        break;
      }
    }
    return;
  }

  // 批量模式下整行都可点选，快速扫一眼就能勾；链接除外。
  if (batchMode && currentTab === "pending" && job && !e.target.closest("a")) {
    const box = e.target.closest(".batch-check");
    toggleSelection(job.id, box ? box.checked : !selectedIds.has(job.id), row);
  }
});

chipRowEl.addEventListener("click", (e) => {
  const item = e.target.closest("[data-bucket]");
  if (!item) return;
  e.preventDefault();
  setActiveBucketKey(item.dataset.bucket);
  currentPage = 1;
  expandedReasons.clear();
  listNeedsEntranceAnimation = true;
  renderJobs();
  scrollToListStart();
});

paginationEl.addEventListener("click", (e) => {
  const link = e.target.closest("[data-page]");
  e.preventDefault();
  if (!link || link.closest(".disabled")) return;
  currentPage = Number(link.dataset.page);
  listNeedsEntranceAnimation = true;
  renderJobs();
  scrollToListStart();
});

function toggleSelection(jobId, selected, row) {
  if (selected) selectedIds.add(jobId);
  else selectedIds.delete(jobId);
  if (row) {
    row.classList.toggle("selected", selected);
    const box = row.querySelector(".batch-check");
    if (box) box.checked = selected;
  }
  updateBatchBar();
}

/* ---------- 弹窗 ---------- */

function openUndecidedDialog(job) {
  undecidedTargetJob = job;
  undecidedForm.reset();
  undecidedOtherReasonEl.classList.add("hidden");
  const note = job.status_note;
  if (note && UNDECIDED_REASON_CATEGORIES.includes(note)) {
    undecidedForm.querySelector(`input[name="undecided-reason"][value="${note}"]`).checked = true;
  } else if (note) {
    undecidedForm.querySelector('input[name="undecided-reason"][value="其他"]').checked = true;
    undecidedOtherReasonEl.value = note;
    undecidedOtherReasonEl.classList.remove("hidden");
  }
  undecidedDialog.showModal();
}

for (const radio of undecidedForm.querySelectorAll('input[name="undecided-reason"]')) {
  radio.addEventListener("change", () => {
    undecidedOtherReasonEl.classList.toggle("hidden", radio.value !== "其他" || !radio.checked);
  });
}

undecidedForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const selected = undecidedForm.querySelector('input[name="undecided-reason"]:checked');
  let reason = selected ? selected.value : null;
  if (reason === "其他") reason = undecidedOtherReasonEl.value.trim() || "其他";
  undecidedDialog.close();
  if (batchReasonStatus) {
    batchReasonStatus = null;
    applyBatch("undecided", reason);
    return;
  }
  if (undecidedTargetJob) {
    setStatus(undecidedTargetJob, "undecided", reason);
    undecidedTargetJob = null;
  }
});

$("undecided-cancel").addEventListener("click", () => {
  undecidedTargetJob = null;
  batchReasonStatus = null;
  undecidedDialog.close();
});

function openProgressDialog(job) {
  progressTargetJob = job;
  progressForm.reset();
  progressErrorEl.textContent = "";
  progressSubjectEl.textContent = `${job.company} · ${job.title}`;
  progressDateEl.value = todayStr();

  // 预选下一个阶段，最常见的操作是往前推一步。
  const stage = jobStage(job);
  const order = STAGES.map((s) => s.key);
  const next = stage === "closed" ? "rejected" : order[Math.min(order.indexOf(stage) + 1, order.length - 2)];
  const radio = progressForm.querySelector(`input[name="progress-stage"][value="${next}"]`);
  if (radio) radio.checked = true;

  progressDialog.showModal();
}

progressForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const selected = progressForm.querySelector('input[name="progress-stage"]:checked');
  if (!selected) {
    progressErrorEl.textContent = "请选择一个阶段";
    return;
  }
  if (!progressDateEl.value) {
    progressErrorEl.textContent = "请选择日期";
    return;
  }

  const job = progressTargetJob;
  progressDialog.close();
  progressTargetJob = null;
  if (!job) return;

  await addEvent(job, {
    stage: selected.value,
    happened_on: progressDateEl.value,
    note: progressNoteEl.value.trim() || null,
  });
});

$("progress-cancel").addEventListener("click", () => {
  progressTargetJob = null;
  progressDialog.close();
});

async function addEvent(job, payload, { expand = true } = {}) {
  if (!session) return;
  const { data, error } = await supabase
    .from("application_events")
    .insert({ job_id: job.id, ...payload })
    .select()
    .single();

  if (error) {
    alert("保存进展失败：" + error.message);
    return;
  }

  if (!eventsByJob.has(job.id)) eventsByJob.set(job.id, []);
  eventsByJob.get(job.id).push(data);
  // 手动记录后展开时间线让你确认写对了；自动补的起点事件不打扰。
  if (expand) expandedTimelines.add(job.id);
  writeEventsCache();
  updateStats();
  renderJobs();
}

async function deleteEvent(job, eventId) {
  if (!session) return;
  const { error } = await supabase.from("application_events").delete().eq("id", eventId);
  if (error) {
    alert("删除失败：" + error.message);
    return;
  }
  eventsByJob.set(job.id, jobEvents(job).filter((e) => e.id !== eventId));
  writeEventsCache();
  updateStats();
  renderJobs();
}

async function deleteEventsFor(job) {
  const { error } = await supabase.from("application_events").delete().eq("job_id", job.id);
  if (error) return;
  eventsByJob.delete(job.id);
  expandedTimelines.delete(job.id);
  writeEventsCache();
}

function openSkipDialog(job) {
  skipTargetJob = job;
  skipForm.reset();
  skipOtherReasonEl.classList.add("hidden");
  skipDialog.showModal();
}

for (const radio of skipForm.querySelectorAll('input[name="skip-reason"]')) {
  radio.addEventListener("change", () => {
    skipOtherReasonEl.classList.toggle("hidden", radio.value !== "其他" || !radio.checked);
  });
}

skipForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const selected = skipForm.querySelector('input[name="skip-reason"]:checked');
  let reason = selected ? selected.value : null;
  if (reason === "其他") reason = skipOtherReasonEl.value.trim() || "其他";
  skipDialog.close();
  if (batchReasonStatus) {
    batchReasonStatus = null;
    applyBatch("skipped", reason);
    return;
  }
  if (skipTargetJob) {
    setStatus(skipTargetJob, "skipped", reason);
    skipTargetJob = null;
  }
});

$("skip-cancel").addEventListener("click", () => {
  skipTargetJob = null;
  batchReasonStatus = null;
  skipDialog.close();
});

/* ---------- 状态更新 ---------- */

async function setStatus(job, newStatus, note) {
  if (!session) return;

  // 撤销投递等于「其实没投」，进度记录一并清掉，但先确认避免误删。
  const existingEvents = jobEvents(job).length;
  if (newStatus === "pending" && existingEvents > 0) {
    const ok = window.confirm(
      `撤销后会一并删除该岗位的 ${existingEvents} 条投递进度记录，且无法恢复。确定继续吗？`
    );
    if (!ok) return;
  }

  const row = jobListEl.querySelector(`.job-row[data-job-id="${job.id}"]`);
  const actionButtons = row ? [...row.querySelectorAll("button")] : [];
  actionButtons.forEach((button) => { button.disabled = true; });

  const previousStatus = job.status;
  const previousNote = job.status_note;
  const payload = { status: newStatus, status_note: note ?? null };
  const updateRequest = Promise.resolve(
    supabase.from("jobs").update(payload).eq("id", job.id).select("id")
  );

  // 先立即更新界面，数据库保存放到后台进行，避免网络延迟阻塞动画。
  job.status = newStatus;
  job.status_note = payload.status_note;
  writeJobsCache();
  updateStats();

  if (row && currentTab === "pending" && newStatus !== "pending") {
    const previousPositions = captureRowPositions(job.id);
    if (newStatus === "applied") await animateAppliedRowOut(row);
    else await animateRowOut(row);
    renderJobs();
    animateRowsIntoPlace(previousPositions);
  } else {
    renderJobs();
  }

  const { data: updated, error: updateError } = await updateRequest;
  const error = updateError || (updated?.length ? null : NO_ROWS_UPDATED);
  if (!error) {
    await syncStageEvents(job, newStatus, previousStatus);
    return;
  }

  // 保存失败时撤销本地状态，让岗位重新出现，避免界面与数据库不一致。
  job.status = previousStatus;
  job.status_note = previousNote;
  writeJobsCache();
  updateStats();
  renderJobs();
  alert("更新失败，岗位已恢复：" + error.message);
}

/** 投递状态变化时同步进度事件：标为已投递自动补起点，撤销则清空。 */
async function syncStageEvents(job, newStatus, previousStatus) {
  if (newStatus === "applied" && previousStatus !== "applied" && !jobEvents(job).length) {
    await addEvent(job, { stage: "applied", happened_on: todayStr(), note: null }, { expand: false });
  } else if (newStatus === "pending") {
    await deleteEventsFor(job);
    updateStats();
    renderJobs();
  }
}

/* ---------- 批量标记 ---------- */

function setBatchMode(on) {
  batchMode = on;
  selectedIds.clear();
  batchBarEl.classList.toggle("hidden", !on);
  batchToggleBtn.classList.toggle("active", on);
  batchToggleBtn.innerHTML = on ? '<i class="ti ti-x"></i>退出批量' : '<i class="ti ti-checkbox"></i>批量标记';
  document.body.classList.toggle("batch-active", on);
  updateBatchBar();
  renderJobs();
}

function updateBatchBar() {
  batchCountEl.textContent = `已选 ${selectedIds.size} 条`;
  for (const btn of batchBarEl.querySelectorAll(".batch-action")) {
    btn.disabled = selectedIds.size === 0;
  }
}

function selectJobs(jobs) {
  for (const job of jobs) selectedIds.add(job.id);
  updateBatchBar();
  renderJobs();
}

/** 按 100 一批提交，避免 id 列表拼进 URL 后超长。 */
async function writeStatusBatch(ids, payload) {
  for (let i = 0; i < ids.length; i += BATCH_WRITE_SIZE) {
    const { data, error } = await supabase
      .from("jobs")
      .update(payload)
      .in("id", ids.slice(i, i + BATCH_WRITE_SIZE))
      .select("id");
    if (error) return error;
    if (!data?.length) return NO_ROWS_UPDATED;
  }
  return null;
}

function applyLocally(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const job of allJobs) {
    const it = byId.get(job.id);
    if (it) {
      job.status = it.status;
      job.status_note = it.status_note;
    }
  }
  writeJobsCache();
  updateStats();
  renderJobs();
}

async function applyBatch(newStatus, note) {
  if (!session) return;
  const jobs = allJobs.filter((j) => selectedIds.has(j.id));
  if (!jobs.length) return;

  // 记下原状态，撤销时按原样还原（每条的原因可能各不相同）。
  const undoItems = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    status_note: j.status_note,
  }));
  const nextItems = jobs.map((j) => ({ id: j.id, status: newStatus, status_note: note ?? null }));

  selectedIds.clear();
  updateBatchBar();
  applyLocally(nextItems);

  const error = await writeStatusBatch(
    jobs.map((j) => j.id),
    { status: newStatus, status_note: note ?? null }
  );
  if (error) {
    applyLocally(undoItems);
    alert("批量更新失败，已恢复：" + error.message);
    return;
  }
  showUndoToast(`已把 ${jobs.length} 个岗位标记为${STATUS_LABELS[newStatus]}`, undoItems);
}

function showUndoToast(text, undoItems) {
  undoTextEl.textContent = text;
  undoToastEl.classList.remove("hidden");
  window.clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => undoToastEl.classList.add("hidden"), UNDO_WINDOW_MS);

  undoBtnEl.onclick = async () => {
    undoToastEl.classList.add("hidden");
    window.clearTimeout(undoTimer);
    applyLocally(undoItems);

    // 原状态可能不止一种，按 (状态, 原因) 分组还原。
    const groups = new Map();
    for (const it of undoItems) {
      const key = JSON.stringify([it.status, it.status_note ?? null]);
      if (!groups.has(key)) groups.set(key, { payload: { status: it.status, status_note: it.status_note }, ids: [] });
      groups.get(key).ids.push(it.id);
    }
    for (const g of groups.values()) {
      const error = await writeStatusBatch(g.ids, g.payload);
      if (error) {
        alert("撤销失败：" + error.message);
        return;
      }
    }
  };
}

function openBatchReasonDialog(status) {
  if (!selectedIds.size) return;
  batchReasonStatus = status;
  if (status === "skipped") {
    skipForm.reset();
    skipOtherReasonEl.classList.add("hidden");
    skipDialog.showModal();
  } else {
    undecidedForm.reset();
    undecidedOtherReasonEl.classList.add("hidden");
    undecidedDialog.showModal();
  }
}

/** 批量只在「待处理」里提供，且必须登录——未登录改不了任何状态。 */
function syncBatchAvailability() {
  const available = currentTab === "pending" && !!session;
  batchToggleBtn.classList.toggle("hidden", !available);
  if (!available && batchMode) setBatchMode(false);
}

batchToggleBtn.addEventListener("click", () => setBatchMode(!batchMode));
$("batch-cancel").addEventListener("click", () => setBatchMode(false));
$("batch-select-page").addEventListener("click", () => selectJobs(currentPageItems));
$("batch-select-all").addEventListener("click", () => {
  const count = currentFiltered.length;
  if (
    count > BATCH_CONFIRM_THRESHOLD &&
    !window.confirm(`将选中当前筛选结果的全部 ${count} 个岗位，确定吗？`)
  ) {
    return;
  }
  selectJobs(currentFiltered);
});
$("batch-skip").addEventListener("click", () => openBatchReasonDialog("skipped"));
$("batch-undecided").addEventListener("click", () => openBatchReasonDialog("undecided"));

/* ---------- 动效 ---------- */

function paperPlaneSvg() {
  return `
    <svg class="paper-plane-svg" viewBox="0 0 40 28" aria-hidden="true">
      <path class="paper-under" d="M3 14 38 3 27 26 19 18 12 23 13.5 16Z" />
      <path class="paper-face" d="M2 12 37 2 25 24 18 16 10 21 12 14Z" />
      <path class="paper-fold" d="M12 14 37 2 18 16M18 16 25 24" />
    </svg>`;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function animateAppliedRowOut(row) {
  if (reducedMotion()) return;
  const planeFlight = animateAppliedPlane(row);
  await new Promise((resolve) => window.setTimeout(resolve, 150));
  await Promise.all([planeFlight, animateRowOut(row)]);
}

function animateAppliedPlane(row) {
  const button = row.querySelector(".act-apply");
  if (!button) return Promise.resolve();

  const rect = button.getBoundingClientRect();
  const plane = document.createElement("span");
  plane.className = "paper-plane-flight";
  plane.innerHTML = paperPlaneSvg();
  plane.style.left = `${rect.left + rect.width / 2 - 23}px`;
  plane.style.top = `${rect.top + rect.height / 2 - 17}px`;
  document.body.appendChild(plane);

  const animation = plane.animate(
    [
      { transform: "translate3d(0, 0, 0) rotate(-7deg) scale(0.9)", opacity: 0 },
      { transform: "translate3d(14px, -6px, 0) rotate(-12deg) scale(1)", opacity: 1, offset: 0.13 },
      { transform: "translate3d(50px, -23px, 0) rotate(-7deg) scale(1.06)", opacity: 1, offset: 0.55 },
      { transform: "translate3d(108px, -64px, 0) rotate(-17deg) scale(0.95)", opacity: 0 }
    ],
    { duration: 650, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
  );

  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      plane.remove();
      resolve();
    };
    animation.addEventListener("finish", finish, { once: true });
    window.setTimeout(finish, 780);
  });
}

function captureRowPositions(excludedJobId) {
  const positions = new Map();
  for (const el of jobListEl.querySelectorAll(".job-row")) {
    if (el.dataset.jobId !== excludedJobId) positions.set(el.dataset.jobId, el.getBoundingClientRect());
  }
  return positions;
}

function animateRowsIntoPlace(previousPositions) {
  if (reducedMotion()) return;
  for (const el of jobListEl.querySelectorAll(".job-row")) {
    const previousRect = previousPositions.get(el.dataset.jobId);
    if (!previousRect) continue;
    const offsetY = previousRect.top - el.getBoundingClientRect().top;
    if (Math.abs(offsetY) < 1) continue;
    el.animate(
      [
        { transform: `translateY(${offsetY}px)` },
        { transform: "translateY(0)" }
      ],
      { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }
}

function animateRowOut(row) {
  if (reducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    row.classList.add("leaving");
    row.addEventListener("animationend", resolve, { once: true });
    window.setTimeout(resolve, 450);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/** 放进 HTML 属性值里的文本还要转义引号。 */
function escapeAttr(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------- 筛选与页签 ---------- */

sourceFilterEl.addEventListener("change", () => {
  currentPage = 1;
  listNeedsEntranceAnimation = true;
  renderJobs();
});
dateFilterEl.addEventListener("change", () => {
  currentPage = 1;
  listNeedsEntranceAnimation = true;
  renderJobs();
});
searchEl.addEventListener("input", () => {
  currentPage = 1;
  listNeedsEntranceAnimation = true;
  renderJobs();
});

const tabButtons = [tabPendingBtn, tabProgressBtn, tabResolvedBtn];
for (const btn of tabButtons) {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    currentTab = btn.dataset.tab;
    currentPage = 1;
    expandedReasons.clear();
    listNeedsEntranceAnimation = true;
    for (const other of tabButtons) {
      other.classList.toggle("active", other.dataset.tab === currentTab);
    }
    syncBatchAvailability();
    renderJobs();
  });
}

refreshAuthUI();
loadJobs();

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.SUPABASE_CONFIG;
if (!cfg || cfg.url.includes("YOUR-PROJECT-REF")) {
  document.getElementById("job-list").innerHTML =
    '<div class="empty-state">还没有配置 Supabase：复制 docs/config.example.js 为 docs/config.js 并填入你的项目信息。</div>';
  throw new Error("Supabase config missing");
}

const supabase = createClient(cfg.url, cfg.anonKey);

const jobListEl = document.getElementById("job-list");
const statTotalEl = document.getElementById("stat-total");
const statAppliedEl = document.getElementById("stat-applied");
const updatedHintEl = document.getElementById("updated-hint");
const authBarEl = document.getElementById("auth-bar");
const sourceFilterEl = document.getElementById("filter-source");
const dateFilterEl = document.getElementById("filter-date");
const searchEl = document.getElementById("filter-search");
const loginDialog = document.getElementById("login-dialog");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const undecidedDialog = document.getElementById("undecided-dialog");
const undecidedForm = document.getElementById("undecided-form");
const undecidedOtherReasonEl = document.getElementById("undecided-other-reason");
const skipDialog = document.getElementById("skip-dialog");
const skipForm = document.getElementById("skip-form");
const skipOtherReasonEl = document.getElementById("skip-other-reason");
const progressDialog = document.getElementById("progress-dialog");
const progressForm = document.getElementById("progress-form");
const progressSubjectEl = document.getElementById("progress-subject");
const progressDateEl = document.getElementById("progress-date");
const progressNoteEl = document.getElementById("progress-note");
const progressErrorEl = document.getElementById("progress-error");
const tabPendingBtn = document.getElementById("tab-pending");
const tabProgressBtn = document.getElementById("tab-progress");
const tabResolvedBtn = document.getElementById("tab-resolved");
const tabPendingCountEl = document.getElementById("tab-pending-count");
const tabProgressCountEl = document.getElementById("tab-progress-count");
const tabResolvedCountEl = document.getElementById("tab-resolved-count");
const batchToggleBtn = document.getElementById("batch-toggle");
const batchBarEl = document.getElementById("batch-bar");
const batchCountEl = document.getElementById("batch-count");
const undoToastEl = document.getElementById("undo-toast");
const undoTextEl = document.getElementById("undo-text");
const undoBtnEl = document.getElementById("undo-btn");
const chipRowEl = document.getElementById("bucket-chips");
const paginationEl = document.getElementById("pagination");
const stickyToolbarEl = document.querySelector(".sticky-toolbar");

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

const STATUS_LABELS = {
  applied: "已投递",
  skipped: "不投递",
  undecided: "待定",
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

// 分组用的当前阶段：记过「未通过」就归入已结束，不再占据活跃列表。
const PROGRESS_GROUPS = [
  ...STAGES.filter((s) => s.key !== "rejected"),
  { key: "closed", label: "已结束" },
];

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

function deadlineTone(deadline) {
  if (!deadline) return "";
  const diffDays = (new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "expired";
  if (diffDays <= 7) return "urgent";
  if (diffDays <= 14) return "soon";
  return "";
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

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
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

async function refreshAuthUI() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) {
    authBarEl.innerHTML = `已登录：${session.user.email} · <button id="logout-btn">退出</button>`;
    document.getElementById("logout-btn").onclick = async () => {
      await supabase.auth.signOut();
      await refreshAuthUI();
    };
  } else {
    authBarEl.innerHTML = `<button id="login-btn">登录（用于记录投递状态）</button>`;
    document.getElementById("login-btn").onclick = () => {
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
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = "登录失败：" + error.message;
    return;
  }
  loginDialog.close();
  loginForm.reset();
  await refreshAuthUI();
});

document.getElementById("login-cancel").addEventListener("click", () => {
  loginDialog.close();
});

async function loadJobs() {
  const syncStartedAt = performance.now();
  jobsLoadError = null;
  const hasCachedJobs = restoreJobsCache();

  if (hasCachedJobs) {
    jobsLoading = false;
    populateSourceFilter();
    updateStats();
    renderJobs();
    showSyncIndicator();
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
    finishSyncIndicator(syncStartedAt);
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
  finishSyncIndicator(syncStartedAt);
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

function showSyncIndicator() {
  let indicator = document.getElementById("sync-indicator");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.id = "sync-indicator";
    indicator.className = "sync-indicator";
    indicator.innerHTML = `<span class="loading-flight" aria-hidden="true">${paperPlaneSvg()}</span><span>正在同步最新岗位…</span>`;
    updatedHintEl.insertAdjacentElement("afterend", indicator);
  }
  indicator.classList.add("visible");
}

function finishSyncIndicator(startedAt, minimumMs = 1100) {
  const indicator = document.getElementById("sync-indicator");
  if (!indicator) return;
  const remaining = Math.max(0, minimumMs - (performance.now() - startedAt));
  window.setTimeout(() => indicator.classList.remove("visible"), remaining);
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
  const sources = [...new Set(allJobs.map((j) => j.source))];
  sourceFilterEl.innerHTML =
    '<option value="">全部来源</option>' +
    sources.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function updateStats() {
  // 「可报名」只算还能投的：已截止的岗位报不了名，不该计入。
  const openJobs = allJobs.filter((j) => !isExpired(j));
  statTotalEl.textContent = openJobs.length;
  statAppliedEl.textContent = allJobs.filter((j) => j.status === "applied").length;
  const latest = allJobs.reduce((max, j) => (j.created_at > max ? j.created_at : max), "");
  updatedHintEl.textContent = latest
    ? `更新于 ${new Date(latest).toLocaleString("zh-CN")} · 共 ${openJobs.length} 条可报名岗位`
    : "";

  // 待处理数字对齐主列表：不含已截止，这样和下面各截止分桶 chip 的计数之和一致。
  const pendingCount = allJobs.filter((j) => j.status === "pending" && !isExpired(j)).length;
  const progressCount = allJobs.filter((j) => j.status === "applied").length;
  const resolvedCount = allJobs.filter(
    (j) => j.status !== "pending" && j.status !== "applied"
  ).length;
  tabPendingCountEl.textContent = `(${pendingCount})`;
  tabProgressCountEl.textContent = `(${progressCount})`;
  tabResolvedCountEl.textContent = `(${resolvedCount})`;
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
  // 已截止岗位仍算待处理，但默认不进主列表，需要时点最后那枚 chip 单独查看。
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
  chipRowEl.innerHTML = "";
  for (const opt of bucketOptions()) {
    const count = bucketFiltered(baseFiltered, opt.key).length;
    const btn = document.createElement("button");
    btn.className =
      "chip" +
      (opt.key === "expired" ? " chip-expired" : "") +
      (activeKey === opt.key ? " active" : "");
    btn.textContent = `${opt.label} (${count})`;
    btn.addEventListener("click", () => {
      setActiveBucketKey(opt.key);
      currentPage = 1;
      expandedReasons.clear();
      listNeedsEntranceAnimation = true;
      renderJobs();
      scrollToListStart();
    });
    chipRowEl.appendChild(btn);
  }
}

function renderPagination(totalPages) {
  paginationEl.innerHTML = "";
  if (totalPages <= 1) return;
  for (let p = 1; p <= totalPages; p++) {
    const btn = document.createElement("button");
    btn.className = "page-btn" + (p === currentPage ? " active" : "");
    btn.textContent = String(p);
    btn.addEventListener("click", () => {
      currentPage = p;
      listNeedsEntranceAnimation = true;
      renderJobs();
      scrollToListStart();
    });
    paginationEl.appendChild(btn);
  }
}

function renderJobs() {
  if (jobsLoading) {
    renderLoadingSkeleton();
    return;
  }
  if (jobsLoadError) {
    jobListEl.innerHTML = `<div class="empty-state">岗位加载失败，请刷新重试。<br><small>${escapeHtml(jobsLoadError)}</small></div>`;
    chipRowEl.innerHTML = "";
    paginationEl.innerHTML = "";
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
      jobListEl.innerHTML = `
        <div class="empty-state empty-state-card">
          <span class="empty-state-icon">✈</span>
          <strong>还没有投递中的岗位</strong>
          <p>在「待处理」里点 ✓ 标记已投递后，岗位会出现在这里，可以逐步记录简历通过、笔试、面试到 Offer 的进展。</p>
        </div>`;
      paginationEl.innerHTML = "";
      return;
    }
    if (currentTab === "pending" && !hasActiveFilters && allJobs.length === 0) {
      jobListEl.innerHTML = `
        <div class="empty-state empty-state-card">
          <span class="empty-state-icon">✓</span>
          <strong>岗位信息已加载完成</strong>
          <p>暂未发现符合2027届报名条件的岗位，系统会在每日更新后自动补充。</p>
        </div>`;
    } else {
      const emptyText =
        currentTab === "pending"
          ? "当前筛选条件下没有待处理岗位。"
          : currentTab === "progress"
            ? "当前筛选条件下没有投递中的岗位。"
            : "还没有符合条件的已处理岗位。";
      jobListEl.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    }
    paginationEl.innerHTML = "";
    return;
  }

  if (currentTab === "resolved" && bucketKey === "skipped") {
    renderReasonBoxes(finalFiltered, SKIP_REASON_CATEGORIES);
    return;
  }
  if (currentTab === "resolved" && bucketKey === "undecided") {
    renderReasonBoxes(finalFiltered, UNDECIDED_REASON_CATEGORIES);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(finalFiltered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = finalFiltered.slice(start, start + PAGE_SIZE);
  currentPageItems = pageItems;

  jobListEl.innerHTML = "";
  if (currentTab === "progress") renderUpcomingBanner(finalFiltered);
  for (const job of pageItems) {
    if (currentTab === "pending") jobListEl.appendChild(renderCard(job));
    else if (currentTab === "progress") jobListEl.appendChild(renderProgressCard(job));
    else jobListEl.appendChild(renderResolvedCard(job));
  }

  if (listNeedsEntranceAnimation) {
    jobListEl.classList.remove("list-enter");
    void jobListEl.offsetWidth;
    jobListEl.classList.add("list-enter");
    listNeedsEntranceAnimation = false;
  }

  renderPagination(totalPages);
}

function scrollToListStart() {
  const top = window.scrollY + jobListEl.getBoundingClientRect().top - stickyToolbarEl.offsetHeight - 8;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function renderLoadingSkeleton() {
  updatedHintEl.textContent = "正在连接招聘信息库…";
  chipRowEl.innerHTML = "";
  paginationEl.innerHTML = "";
  jobListEl.innerHTML = `
    <div class="loading-heading">
      <span class="loading-flight" aria-hidden="true">${paperPlaneSvg()}</span>
      正在加载最新岗位信息…
    </div>
    ${[0, 1, 2].map((index) => `
      <div class="skeleton-card" aria-hidden="true">
        <i class="skeleton-line title${index === 1 ? " short" : ""}"></i>
        <i class="skeleton-line medium${index === 2 ? " short" : ""}"></i>
        <i class="skeleton-line long"></i>
        <i class="skeleton-line footer"></i>
      </div>`).join("")}
  `;
}

function renderReasonBoxes(jobs, categories) {
  jobListEl.innerHTML = "";
  paginationEl.innerHTML = "";

  const boxes = [...categories, "其他原因"];
  for (const reason of boxes) {
    const group = jobs.filter((j) =>
      reason === "其他原因" ? !categories.includes(j.status_note) : j.status_note === reason
    );

    const isOpen = expandedReasons.has(reason);

    const box = document.createElement("div");
    box.className = "reason-box" + (isOpen ? " open" : "");

    const title = document.createElement("button");
    title.type = "button";
    title.className = "reason-box-title";
    title.innerHTML = `<span class="chevron">${isOpen ? "▾" : "▸"}</span><span>${escapeHtml(reason)}</span><span class="count">${group.length}</span>`;
    title.addEventListener("click", () => {
      if (expandedReasons.has(reason)) expandedReasons.delete(reason);
      else expandedReasons.add(reason);
      renderJobs();
    });
    box.appendChild(title);

    if (isOpen) {
      const body = document.createElement("div");
      body.className = "reason-box-body";
      if (group.length === 0) {
        body.innerHTML = '<div class="empty-state small">暂无</div>';
      } else {
        for (const job of group) body.appendChild(renderResolvedCard(job));
      }
      box.appendChild(body);
    }
    jobListEl.appendChild(box);
  }
}

function renderCard(job) {
  const card = document.createElement("div");
  const notInterested = !!job.interest_tag;
  card.className =
    "job-card" + (notInterested ? " not-interested" : "") + (isExpired(job) ? " expired" : "");
  card.dataset.jobId = job.id;

  if (batchMode && selectedIds.has(job.id)) card.classList.add("selected");

  card.innerHTML = `
    <div class="job-card-top">
      ${batchMode ? `<input type="checkbox" class="batch-check" ${selectedIds.has(job.id) ? "checked" : ""} aria-label="选择该岗位">` : ""}
      <div class="job-card-main">
        <div class="job-card-title-row">
          <span class="company">${escapeHtml(job.company)}</span>
          <span class="salary-tag">${escapeHtml(job.salary || "薪资未注明")}</span>
          ${notInterested ? '<span class="badge not-interested">不感兴趣</span>' : ""}
          ${isToday(job.created_at) ? '<span class="badge new">今日新增</span>' : ""}
        </div>
        <p class="job-title">${escapeHtml(job.title)}${job.location ? " · " + escapeHtml(job.location) : ""}</p>
        <div class="job-meta-row">
          ${job.education ? `<span class="meta-chip">学历 · ${escapeHtml(job.education)}</span>` : ""}
          <span class="meta-chip meta-major">专业 · ${escapeHtml(job.major_requirement || "详见职位描述")}</span>
        </div>
        ${job.eligible_reason ? `<p class="reason match-reason">匹配 · ${escapeHtml(job.eligible_reason)}</p>` : ""}
      </div>
      <div class="job-actions">
        <button class="icon-btn check" title="标记已投递" ${session ? "" : "disabled"}>✓</button>
        <button class="icon-btn undecided" title="标记待定" ${session ? "" : "disabled"}>?</button>
        <button class="icon-btn cross" title="标记不投递" ${session ? "" : "disabled"}>✕</button>
      </div>
    </div>
    <div class="job-card-bottom">
      <a href="${job.url}" target="_blank" rel="noopener">查看原始公告 ↗</a>
      <span class="status-hint deadline ${deadlineTone(job.deadline)}">${job.deadline ? "截止 " + fmtDate(job.deadline) : "未注明截止日期"}</span>
    </div>
  `;

  if (batchMode) {
    // 整张卡都可点选，快速扫标签时不用瞄准那个小方框；链接除外。
    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      toggleSelection(job.id, !selectedIds.has(job.id), card);
    });
  } else {
    card.querySelector(".icon-btn.check").addEventListener("click", () => setStatus(job, "applied"));
    card.querySelector(".icon-btn.cross").addEventListener("click", () => openSkipDialog(job));
    card.querySelector(".icon-btn.undecided").addEventListener("click", () => openUndecidedDialog(job));
  }

  return card;
}

function toggleSelection(jobId, selected, card) {
  if (selected) selectedIds.add(jobId);
  else selectedIds.delete(jobId);
  if (card) {
    card.classList.toggle("selected", selected);
    const box = card.querySelector(".batch-check");
    if (box) box.checked = selected;
  }
  updateBatchBar();
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

function renderUpcomingBanner(jobs) {
  const upcoming = [];
  for (const job of jobs) {
    for (const event of sortedEvents(job)) {
      const days = daysFromToday(event.happened_on);
      if (days > 0 && days <= UPCOMING_DAYS) upcoming.push({ job, event, days });
    }
  }
  if (!upcoming.length) return;

  upcoming.sort((a, b) => a.days - b.days);
  const banner = document.createElement("div");
  banner.className = "upcoming-banner";
  banner.innerHTML = `
    <div class="upcoming-title">即将到来（${UPCOMING_DAYS} 天内）</div>
    <ul>
      ${upcoming
        .map(
          ({ job, event, days }) => `
        <li>
          <span class="upcoming-when">${days === 1 ? "明天" : `${days} 天后`}</span>
          <span class="upcoming-date">${event.happened_on.slice(5)}</span>
          <span class="upcoming-stage">${STAGE_LABELS[event.stage]}</span>
          <span class="upcoming-company">${escapeHtml(job.company)}</span>
          ${event.note ? `<span class="upcoming-note">${escapeHtml(event.note)}</span>` : ""}
        </li>`
        )
        .join("")}
    </ul>`;
  jobListEl.appendChild(banner);
}

function renderProgressCard(job) {
  const stage = jobStage(job);
  const closed = stage === "closed";
  const card = document.createElement("div");
  card.className = "job-card progress-card" + (closed ? " closed" : "");
  card.dataset.jobId = job.id;

  const events = sortedEvents(job);
  const upcoming = nextSchedule(job);
  const stalled = daysInCurrentStage(job);
  const isOpen = expandedTimelines.has(job.id);

  const stageLabel = closed ? "已结束" : STAGE_LABELS[stage] || stage;
  const stalledText =
    stalled === null ? "" : stalled === 0 ? "今天更新" : `已停留 ${stalled} 天`;
  const upcomingDays = upcoming ? daysFromToday(upcoming.happened_on) : null;

  card.innerHTML = `
    <div class="job-card-top">
      <div class="job-card-main">
        <div class="job-card-title-row">
          <span class="company">${escapeHtml(job.company)}</span>
          <span class="badge stage-${closed ? "closed" : stage}">${stageLabel}</span>
          ${stalledText ? `<span class="stalled-hint${stalled >= 14 && !closed ? " warn" : ""}">${stalledText}</span>` : ""}
        </div>
        <p class="job-title">${escapeHtml(job.title)}${job.location ? " · " + escapeHtml(job.location) : ""}</p>
        ${
          upcoming
            ? `<p class="next-schedule"><span class="cal">📅</span>${upcoming.happened_on.slice(5)} ${STAGE_LABELS[upcoming.stage]}${upcoming.note ? " · " + escapeHtml(upcoming.note) : ""} · ${upcomingDays === 1 ? "明天" : `还有 ${upcomingDays} 天`}</p>`
            : ""
        }
      </div>
      <div class="job-actions">
        <button class="icon-btn add-event" title="记录进展" ${session ? "" : "disabled"}>＋</button>
        <button class="icon-btn revert" title="撤销投递，移回待处理" ${session ? "" : "disabled"}>↺</button>
      </div>
    </div>
    <div class="job-card-bottom">
      <a href="${job.url}" target="_blank" rel="noopener">查看原始公告 ↗</a>
      <button type="button" class="timeline-toggle">${isOpen ? "▾" : "▸"} 时间线（${events.length}）</button>
    </div>
    ${isOpen ? renderTimeline(events) : ""}
  `;

  card.querySelector(".icon-btn.add-event").addEventListener("click", () => openProgressDialog(job));
  card.querySelector(".icon-btn.revert").addEventListener("click", () => setStatus(job, "pending", null));
  card.querySelector(".timeline-toggle").addEventListener("click", () => {
    if (expandedTimelines.has(job.id)) expandedTimelines.delete(job.id);
    else expandedTimelines.add(job.id);
    renderJobs();
  });
  for (const btn of card.querySelectorAll(".timeline-delete")) {
    btn.addEventListener("click", () => deleteEvent(job, btn.dataset.eventId));
  }

  return card;
}

function renderTimeline(events) {
  if (!events.length) return '<div class="timeline"><p class="timeline-empty">还没有记录</p></div>';
  return `
    <div class="timeline">
      ${[...events]
        .reverse()
        .map((e) => {
          const days = daysFromToday(e.happened_on);
          return `
        <div class="timeline-row${days > 0 ? " future" : ""}">
          <span class="timeline-dot"></span>
          <span class="timeline-date">${e.happened_on.slice(5)}</span>
          <span class="timeline-stage">${STAGE_LABELS[e.stage] || e.stage}</span>
          ${e.note ? `<span class="timeline-note">${escapeHtml(e.note)}</span>` : ""}
          <button type="button" class="timeline-delete" data-event-id="${e.id}" title="删除这条记录">✕</button>
        </div>`;
        })
        .join("")}
    </div>`;
}

function renderResolvedCard(job) {
  const card = document.createElement("div");
  card.className = "job-card resolved";

  card.innerHTML = `
    <div class="job-card-top">
      <div class="job-card-main">
        <div class="job-card-title-row">
          <span class="company">${escapeHtml(job.company)}</span>
          <span class="badge status-${job.status}">${STATUS_LABELS[job.status] || job.status}</span>
          <span class="salary-tag">${escapeHtml(job.salary || "薪资未注明")}</span>
        </div>
        <p class="job-title">${escapeHtml(job.title)}${job.location ? " · " + escapeHtml(job.location) : ""}</p>
        <div class="job-meta-row">
          ${job.education ? `<span class="meta-chip">学历 · ${escapeHtml(job.education)}</span>` : ""}
          <span class="meta-chip meta-major">专业 · ${escapeHtml(job.major_requirement || "详见职位描述")}</span>
        </div>
        ${job.status_note ? `<p class="reason">原因：${escapeHtml(job.status_note)}</p>` : ""}
      </div>
      <div class="job-actions">
        <button class="icon-btn revert" title="撤销，移回待处理" ${session ? "" : "disabled"}>↺</button>
      </div>
    </div>
    <div class="job-card-bottom">
      <a href="${job.url}" target="_blank" rel="noopener">查看原始公告 ↗</a>
      <span class="status-hint">处理于 ${fmtDateTime(job.updated_at)}</span>
    </div>
  `;

  card.querySelector(".icon-btn.revert").addEventListener("click", () => setStatus(job, "pending", null));

  return card;
}

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

document.getElementById("undecided-cancel").addEventListener("click", () => {
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

document.getElementById("progress-cancel").addEventListener("click", () => {
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

document.getElementById("skip-cancel").addEventListener("click", () => {
  skipTargetJob = null;
  batchReasonStatus = null;
  skipDialog.close();
});

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

  const card = [...jobListEl.querySelectorAll(".job-card")].find(
    (element) => element.dataset.jobId === job.id
  );
  const actionButtons = card ? [...card.querySelectorAll("button")] : [];
  actionButtons.forEach((button) => { button.disabled = true; });

  const previousStatus = job.status;
  const previousNote = job.status_note;
  const payload = { status: newStatus, status_note: note ?? null };
  const updateRequest = Promise.resolve(
    supabase.from("jobs").update(payload).eq("id", job.id)
  );

  // 先立即更新界面，数据库保存放到后台进行，避免网络延迟阻塞动画。
  job.status = newStatus;
  job.status_note = payload.status_note;
  writeJobsCache();
  updateStats();

  if (card && currentTab === "pending" && newStatus !== "pending") {
    const previousPositions = captureCardPositions(card.dataset.jobId);
    if (newStatus === "applied") await animateAppliedCardOut(card);
    else await animateCardOut(card);
    renderJobs();
    animateCardsIntoPlace(previousPositions);
  } else {
    renderJobs();
  }

  const { error } = await updateRequest;
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
    renderJobs();
  }
}

/* ---------- 批量标记 ---------- */

function setBatchMode(on) {
  batchMode = on;
  selectedIds.clear();
  batchBarEl.classList.toggle("hidden", !on);
  batchToggleBtn.classList.toggle("active", on);
  batchToggleBtn.textContent = on ? "退出批量" : "批量";
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
    const { error } = await supabase
      .from("jobs")
      .update(payload)
      .in("id", ids.slice(i, i + BATCH_WRITE_SIZE));
    if (error) return error;
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
document.getElementById("batch-cancel").addEventListener("click", () => setBatchMode(false));
document.getElementById("batch-select-page").addEventListener("click", () => selectJobs(currentPageItems));
document.getElementById("batch-select-all").addEventListener("click", () => {
  const count = currentFiltered.length;
  if (
    count > BATCH_CONFIRM_THRESHOLD &&
    !window.confirm(`将选中当前筛选结果的全部 ${count} 个岗位，确定吗？`)
  ) {
    return;
  }
  selectJobs(currentFiltered);
});
document.getElementById("batch-skip").addEventListener("click", () => openBatchReasonDialog("skipped"));
document.getElementById("batch-undecided").addEventListener("click", () => openBatchReasonDialog("undecided"));

function paperPlaneSvg() {
  return `
    <svg class="paper-plane-svg" viewBox="0 0 40 28" aria-hidden="true">
      <path class="paper-under" d="M3 14 38 3 27 26 19 18 12 23 13.5 16Z" />
      <path class="paper-face" d="M2 12 37 2 25 24 18 16 10 21 12 14Z" />
      <path class="paper-fold" d="M12 14 37 2 18 16M18 16 25 24" />
    </svg>`;
}

async function animateAppliedCardOut(card) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await animateCardOut(card);
    return;
  }

  const planeFlight = animateAppliedPlane(card);
  await new Promise((resolve) => window.setTimeout(resolve, 150));
  await Promise.all([planeFlight, animateCardOut(card)]);
}

function animateAppliedPlane(card) {
  const button = card.querySelector(".icon-btn.check");
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

function captureCardPositions(excludedJobId) {
  const positions = new Map();
  for (const element of jobListEl.querySelectorAll(".job-card")) {
    if (element.dataset.jobId !== excludedJobId) {
      positions.set(element.dataset.jobId, element.getBoundingClientRect());
    }
  }
  return positions;
}

function animateCardsIntoPlace(previousPositions) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  for (const element of jobListEl.querySelectorAll(".job-card")) {
    const previousRect = previousPositions.get(element.dataset.jobId);
    if (!previousRect) continue;

    const currentRect = element.getBoundingClientRect();
    const offsetY = previousRect.top - currentRect.top;
    if (Math.abs(offsetY) < 1) continue;

    element.animate(
      [
        { transform: `translateY(${offsetY}px)` },
        { transform: "translateY(-5px)", offset: 0.76 },
        { transform: "translateY(2px)", offset: 0.9 },
        { transform: "translateY(0)" }
      ],
      {
        duration: 480,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both"
      }
    );
  }
}

function animateCardOut(card) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    card.classList.add("fade-out-right-to-left");
    card.addEventListener("animationend", resolve, { once: true });
    window.setTimeout(resolve, 500);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

sourceFilterEl.addEventListener("change", () => {
  currentPage = 1;
  listNeedsEntranceAnimation = true;
  renderJobs();
  scrollToListStart();
});
dateFilterEl.addEventListener("change", () => {
  currentPage = 1;
  listNeedsEntranceAnimation = true;
  renderJobs();
  scrollToListStart();
});
searchEl.addEventListener("input", () => {
  currentPage = 1;
  listNeedsEntranceAnimation = true;
  renderJobs();
});

const tabButtons = [tabPendingBtn, tabProgressBtn, tabResolvedBtn];
for (const btn of tabButtons) {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    currentPage = 1;
    expandedReasons.clear();
    listNeedsEntranceAnimation = true;
    for (const other of tabButtons) {
      other.classList.toggle("active", other.dataset.tab === currentTab);
    }
    syncBatchAvailability();
    renderJobs();
    scrollToListStart();
  });
}

refreshAuthUI();
loadJobs();

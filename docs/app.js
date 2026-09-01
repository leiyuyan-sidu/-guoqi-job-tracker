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
const tabPendingBtn = document.getElementById("tab-pending");
const tabResolvedBtn = document.getElementById("tab-resolved");
const tabPendingCountEl = document.getElementById("tab-pending-count");
const tabResolvedCountEl = document.getElementById("tab-resolved-count");
const chipRowEl = document.getElementById("bucket-chips");
const paginationEl = document.getElementById("pagination");
const stickyToolbarEl = document.querySelector(".sticky-toolbar");

const PAGE_SIZE = 10;
const JOB_CACHE_KEY = "guoqi-job-tracker:jobs:v1";
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
let currentPage = 1;
let expandedReasons = new Set();
let listNeedsEntranceAnimation = true;

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

const RESOLVED_GROUPS = [
  { key: "applied", label: "已投递" },
  { key: "skipped", label: "不投递" },
  { key: "undecided", label: "待定" },
];

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
  renderJobs();
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
  loadSalaries();
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
    const cached = JSON.parse(localStorage.getItem(JOB_CACHE_KEY));
    if (!cached || !Array.isArray(cached.jobs)) return false;
    allJobs = cached.jobs;
    return true;
  } catch {
    return false;
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
  statTotalEl.textContent = allJobs.length;
  statAppliedEl.textContent = allJobs.filter((j) => j.status === "applied").length;
  const latest = allJobs.reduce((max, j) => (j.created_at > max ? j.created_at : max), "");
  updatedHintEl.textContent = latest
    ? `更新于 ${new Date(latest).toLocaleString("zh-CN")} · 共 ${allJobs.length} 条可报名岗位`
    : "";

  // 待处理数字对齐主列表：不含已截止，这样和下面各截止分桶 chip 的计数之和一致。
  const pendingCount = allJobs.filter((j) => j.status === "pending" && !isExpired(j)).length;
  const resolvedCount = allJobs.filter((j) => j.status !== "pending").length;
  tabPendingCountEl.textContent = `(${pendingCount})`;
  tabResolvedCountEl.textContent = `(${resolvedCount})`;
}

function jobBucketKey(job) {
  return currentTab === "pending" ? deadlineBucket(job.deadline) : job.status;
}

function bucketOptions() {
  const groups = currentTab === "pending" ? DEADLINE_BUCKETS : RESOLVED_GROUPS;
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
  return currentTab === "pending" ? pendingBucket : resolvedGroup;
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
      if (currentTab === "pending") pendingBucket = opt.key;
      else resolvedGroup = opt.key;
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
    return j.status !== "pending";
  });

  renderBucketChips(baseFiltered);

  const bucketKey = activeBucketKey();
  let finalFiltered = bucketFiltered(baseFiltered, bucketKey);

  if (currentTab === "resolved") {
    finalFiltered = [...finalFiltered].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }

  if (finalFiltered.length === 0) {
    const hasActiveFilters = Boolean(sourceVal || dateVal || q || bucketKey !== "all");
    if (currentTab === "pending" && !hasActiveFilters && allJobs.length === 0) {
      jobListEl.innerHTML = `
        <div class="empty-state empty-state-card">
          <span class="empty-state-icon">✓</span>
          <strong>岗位信息已加载完成</strong>
          <p>暂未发现符合2027届报名条件的岗位，系统会在每日更新后自动补充。</p>
        </div>`;
    } else {
      jobListEl.innerHTML =
        currentTab === "pending"
          ? '<div class="empty-state">当前筛选条件下没有待处理岗位。</div>'
          : '<div class="empty-state">还没有符合条件的已处理岗位。</div>';
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

  jobListEl.innerHTML = "";
  for (const job of pageItems) {
    jobListEl.appendChild(currentTab === "pending" ? renderCard(job) : renderResolvedCard(job));
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

  card.innerHTML = `
    <div class="job-card-top">
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

  card.querySelector(".icon-btn.check").addEventListener("click", () => setStatus(job, "applied"));
  card.querySelector(".icon-btn.cross").addEventListener("click", () => openSkipDialog(job));
  card.querySelector(".icon-btn.undecided").addEventListener("click", () => openUndecidedDialog(job));

  return card;
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
  if (undecidedTargetJob) {
    setStatus(undecidedTargetJob, "undecided", reason);
    undecidedTargetJob = null;
  }
});

document.getElementById("undecided-cancel").addEventListener("click", () => {
  undecidedTargetJob = null;
  undecidedDialog.close();
});

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
  if (skipTargetJob) {
    setStatus(skipTargetJob, "skipped", reason);
    skipTargetJob = null;
  }
});

document.getElementById("skip-cancel").addEventListener("click", () => {
  skipTargetJob = null;
  skipDialog.close();
});

async function setStatus(job, newStatus, note) {
  if (!session) return;
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
  if (!error) return;

  // 保存失败时撤销本地状态，让岗位重新出现，避免界面与数据库不一致。
  job.status = previousStatus;
  job.status_note = previousNote;
  writeJobsCache();
  updateStats();
  renderJobs();
  alert("更新失败，岗位已恢复：" + error.message);
}

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

for (const btn of [tabPendingBtn, tabResolvedBtn]) {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    currentPage = 1;
    expandedReasons.clear();
    listNeedsEntranceAnimation = true;
    tabPendingBtn.classList.toggle("active", currentTab === "pending");
    tabResolvedBtn.classList.toggle("active", currentTab === "resolved");
    renderJobs();
    scrollToListStart();
  });
}

refreshAuthUI();
loadJobs();

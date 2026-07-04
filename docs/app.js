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

const PAGE_SIZE = 10;

let session = null;
let allJobs = [];
let currentTab = "pending";
let undecidedTargetJob = null;
let skipTargetJob = null;
let pendingBucket = "all";
let resolvedGroup = "all";
let currentPage = 1;

const STATUS_LABELS = {
  applied: "已投递",
  skipped: "不投递",
  undecided: "待定",
};

const DEADLINE_BUCKETS = [
  { key: "expired", label: "已截止" },
  { key: "week1", label: "一周内截止" },
  { key: "week2", label: "两周内截止" },
  { key: "month1", label: "一个月内截止" },
  { key: "monthplus", label: "一个月以上" },
  { key: "none", label: "未注明截止日期" },
];

const RESOLVED_GROUPS = [
  { key: "applied", label: "已投递" },
  { key: "skipped", label: "不投递" },
  { key: "undecided", label: "待定" },
];

const SKIP_REASON_CATEGORIES = ["工资太低", "地区不合适", "工作内容不喜欢"];
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
  jobListEl.innerHTML = '<div class="loading-state">加载中…</div>';
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("eligible", true)
    .order("created_at", { ascending: false });

  if (error) {
    jobListEl.innerHTML = `<div class="empty-state">加载失败：${error.message}</div>`;
    return;
  }
  allJobs = data;
  populateSourceFilter();
  updateStats();
  renderJobs();
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

  const pendingCount = allJobs.filter((j) => j.status === "pending").length;
  const resolvedCount = allJobs.length - pendingCount;
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

function activeBucketKey() {
  return currentTab === "pending" ? pendingBucket : resolvedGroup;
}

function renderBucketChips(baseFiltered) {
  const activeKey = activeBucketKey();
  chipRowEl.innerHTML = "";
  for (const opt of bucketOptions()) {
    const count =
      opt.key === "all" ? baseFiltered.length : baseFiltered.filter((j) => jobBucketKey(j) === opt.key).length;
    const btn = document.createElement("button");
    btn.className = "chip" + (activeKey === opt.key ? " active" : "");
    btn.textContent = `${opt.label} (${count})`;
    btn.addEventListener("click", () => {
      if (currentTab === "pending") pendingBucket = opt.key;
      else resolvedGroup = opt.key;
      currentPage = 1;
      renderJobs();
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
      renderJobs();
    });
    paginationEl.appendChild(btn);
  }
}

function renderJobs() {
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
  let finalFiltered =
    bucketKey === "all" ? baseFiltered : baseFiltered.filter((j) => jobBucketKey(j) === bucketKey);

  if (currentTab === "resolved") {
    finalFiltered = [...finalFiltered].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }

  if (finalFiltered.length === 0) {
    jobListEl.innerHTML =
      currentTab === "pending"
        ? '<div class="empty-state">没有符合条件的待处理岗位。</div>'
        : '<div class="empty-state">还没有符合条件的已处理岗位。</div>';
    paginationEl.innerHTML = "";
    return;
  }

  if (currentTab === "resolved" && bucketKey === "skipped") {
    renderSkippedByReason(finalFiltered);
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

  renderPagination(totalPages);
}

function renderSkippedByReason(jobs) {
  jobListEl.innerHTML = "";
  paginationEl.innerHTML = "";

  const boxes = [...SKIP_REASON_CATEGORIES, "其他原因"];
  for (const reason of boxes) {
    const group = jobs.filter((j) =>
      reason === "其他原因" ? !SKIP_REASON_CATEGORIES.includes(j.status_note) : j.status_note === reason
    );

    const box = document.createElement("div");
    box.className = "reason-box";
    box.innerHTML = `<div class="reason-box-title">${escapeHtml(reason)} <span class="count">${group.length}</span></div>`;

    const body = document.createElement("div");
    body.className = "reason-box-body";
    if (group.length === 0) {
      body.innerHTML = '<div class="empty-state small">暂无</div>';
    } else {
      for (const job of group) body.appendChild(renderResolvedCard(job));
    }
    box.appendChild(body);
    jobListEl.appendChild(box);
  }
}

function renderCard(job) {
  const card = document.createElement("div");
  const notInterested = !!job.interest_tag;
  card.className = "job-card" + (notInterested ? " not-interested" : "");

  card.innerHTML = `
    <div class="job-card-top">
      <div class="job-card-main">
        <div class="job-card-title-row">
          <span class="company">${escapeHtml(job.company)}</span>
          <span class="badge eligible">可报名</span>
          ${notInterested ? '<span class="badge not-interested">不感兴趣</span>' : ""}
          ${isToday(job.created_at) ? '<span class="badge new">今日新增</span>' : ""}
        </div>
        <p class="job-title">${escapeHtml(job.title)}${job.location ? " · " + escapeHtml(job.location) : ""}</p>
        <p class="job-major">专业要求：${escapeHtml(job.major_requirement || "详见职位描述")}${job.education ? "（" + escapeHtml(job.education) + "）" : ""}</p>
        ${job.eligible_reason ? `<p class="reason">${escapeHtml(job.eligible_reason)}</p>` : ""}
      </div>
      <div class="job-actions">
        <button class="icon-btn check" title="标记已投递" ${session ? "" : "disabled"}>✓</button>
        <button class="icon-btn undecided" title="标记待定" ${session ? "" : "disabled"}>?</button>
        <button class="icon-btn cross" title="标记不投递" ${session ? "" : "disabled"}>✕</button>
      </div>
    </div>
    <div class="job-card-bottom">
      <a href="${job.url}" target="_blank" rel="noopener">查看原始公告 ↗</a>
      <span class="status-hint">${job.deadline ? "截止 " + fmtDate(job.deadline) : ""}</span>
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
        </div>
        <p class="job-title">${escapeHtml(job.title)}${job.location ? " · " + escapeHtml(job.location) : ""}</p>
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
  const payload = { status: newStatus, status_note: note ?? null };
  const { error } = await supabase.from("jobs").update(payload).eq("id", job.id);
  if (error) {
    alert("更新失败：" + error.message);
    return;
  }
  job.status = newStatus;
  job.status_note = payload.status_note;
  updateStats();
  renderJobs();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

sourceFilterEl.addEventListener("change", () => {
  currentPage = 1;
  renderJobs();
});
dateFilterEl.addEventListener("change", () => {
  currentPage = 1;
  renderJobs();
});
searchEl.addEventListener("input", () => {
  currentPage = 1;
  renderJobs();
});

for (const btn of [tabPendingBtn, tabResolvedBtn]) {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    currentPage = 1;
    tabPendingBtn.classList.toggle("active", currentTab === "pending");
    tabResolvedBtn.classList.toggle("active", currentTab === "resolved");
    renderJobs();
  });
}

refreshAuthUI();
loadJobs();

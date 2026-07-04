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
const searchEl = document.getElementById("filter-search");
const loginDialog = document.getElementById("login-dialog");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const undecidedDialog = document.getElementById("undecided-dialog");
const undecidedForm = document.getElementById("undecided-form");
const undecidedReasonEl = document.getElementById("undecided-reason");
const tabPendingBtn = document.getElementById("tab-pending");
const tabResolvedBtn = document.getElementById("tab-resolved");
const tabPendingCountEl = document.getElementById("tab-pending-count");
const tabResolvedCountEl = document.getElementById("tab-resolved-count");

let session = null;
let allJobs = [];
let currentTab = "pending";
let undecidedTargetJob = null;

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
  { key: "undecided", label: "其他原因" },
];

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

function renderJobs() {
  const sourceVal = sourceFilterEl.value;
  const q = searchEl.value.trim().toLowerCase();

  const filtered = allJobs.filter((j) => {
    if (sourceVal && j.source !== sourceVal) return false;
    if (q && !(j.company.toLowerCase().includes(q) || j.title.toLowerCase().includes(q))) return false;
    if (currentTab === "pending") return j.status === "pending";
    return j.status !== "pending";
  });

  if (filtered.length === 0) {
    jobListEl.innerHTML =
      currentTab === "pending"
        ? '<div class="empty-state">没有待处理的可报名岗位。</div>'
        : '<div class="empty-state">还没有已处理的岗位。</div>';
    return;
  }

  jobListEl.innerHTML = "";

  if (currentTab === "pending") {
    for (const bucket of DEADLINE_BUCKETS) {
      const group = filtered.filter((j) => deadlineBucket(j.deadline) === bucket.key);
      if (group.length === 0) continue;
      jobListEl.appendChild(renderSectionHeader(bucket.label, group.length));
      for (const job of group) jobListEl.appendChild(renderCard(job));
    }
  } else {
    filtered.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    for (const groupDef of RESOLVED_GROUPS) {
      const group = filtered.filter((j) => j.status === groupDef.key);
      if (group.length === 0) continue;
      jobListEl.appendChild(renderSectionHeader(groupDef.label, group.length));
      for (const job of group) jobListEl.appendChild(renderResolvedCard(job));
    }
  }
}

function renderSectionHeader(label, count) {
  const el = document.createElement("div");
  el.className = "section-header";
  el.innerHTML = `${escapeHtml(label)} <span class="count">${count}</span>`;
  return el;
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
  card.querySelector(".icon-btn.cross").addEventListener("click", () => setStatus(job, "skipped"));
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
  undecidedReasonEl.value = job.status_note || "";
  undecidedDialog.showModal();
}

undecidedForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const reason = undecidedReasonEl.value.trim();
  undecidedDialog.close();
  if (undecidedTargetJob) {
    setStatus(undecidedTargetJob, "undecided", reason || null);
    undecidedTargetJob = null;
  }
});

document.getElementById("undecided-cancel").addEventListener("click", () => {
  undecidedTargetJob = null;
  undecidedDialog.close();
});

async function setStatus(job, newStatus, note) {
  if (!session) return;
  const payload = { status: newStatus, status_note: newStatus === "undecided" ? note : null };
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

sourceFilterEl.addEventListener("change", renderJobs);
searchEl.addEventListener("input", renderJobs);

for (const btn of [tabPendingBtn, tabResolvedBtn]) {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    tabPendingBtn.classList.toggle("active", currentTab === "pending");
    tabResolvedBtn.classList.toggle("active", currentTab === "resolved");
    renderJobs();
  });
}

refreshAuthUI();
loadJobs();

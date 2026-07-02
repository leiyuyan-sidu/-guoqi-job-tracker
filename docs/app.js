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
const statusFilterEl = document.getElementById("filter-status");
const searchEl = document.getElementById("filter-search");
const loginDialog = document.getElementById("login-dialog");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

let session = null;
let allJobs = [];

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
}

function renderJobs() {
  const sourceVal = sourceFilterEl.value;
  const statusVal = statusFilterEl.value;
  const q = searchEl.value.trim().toLowerCase();

  const filtered = allJobs.filter((j) => {
    if (sourceVal && j.source !== sourceVal) return false;
    if (statusVal && j.status !== statusVal) return false;
    if (q && !(j.company.toLowerCase().includes(q) || j.title.toLowerCase().includes(q))) return false;
    return true;
  });

  if (filtered.length === 0) {
    jobListEl.innerHTML = '<div class="empty-state">没有符合条件的岗位。</div>';
    return;
  }

  jobListEl.innerHTML = "";
  for (const job of filtered) {
    jobListEl.appendChild(renderCard(job));
  }
}

function renderCard(job) {
  const card = document.createElement("div");
  const notInterested = !!job.interest_tag;
  card.className = "job-card" + (notInterested ? " not-interested" : "");

  const statusLabel =
    job.status === "applied" ? "已投递" : job.status === "skipped" ? "已标记不投递" : "";
  const statusClass = job.status === "applied" ? "applied" : job.status === "skipped" ? "skipped" : "";

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
        <button class="icon-btn check ${job.status === "applied" ? "active" : ""}" title="标记已投递" ${session ? "" : "disabled"}>✓</button>
        <button class="icon-btn cross ${job.status === "skipped" ? "active" : ""}" title="标记不投递" ${session ? "" : "disabled"}>✕</button>
      </div>
    </div>
    <div class="job-card-bottom">
      <a href="${job.url}" target="_blank" rel="noopener">查看原始公告 ↗</a>
      <span class="status-hint ${statusClass}">${statusLabel || (job.deadline ? "截止 " + fmtDate(job.deadline) : "")}</span>
    </div>
  `;

  const checkBtn = card.querySelector(".icon-btn.check");
  const crossBtn = card.querySelector(".icon-btn.cross");
  checkBtn.addEventListener("click", () => setStatus(job, job.status === "applied" ? "pending" : "applied"));
  crossBtn.addEventListener("click", () => setStatus(job, job.status === "skipped" ? "pending" : "skipped"));

  return card;
}

async function setStatus(job, newStatus) {
  if (!session) return;
  const { error } = await supabase.from("jobs").update({ status: newStatus }).eq("id", job.id);
  if (error) {
    alert("更新失败：" + error.message);
    return;
  }
  job.status = newStatus;
  updateStats();
  renderJobs();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

sourceFilterEl.addEventListener("change", renderJobs);
statusFilterEl.addEventListener("change", renderJobs);
searchEl.addEventListener("input", renderJobs);

refreshAuthUI();
loadJobs();

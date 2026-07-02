// 复制这个文件为 config.js，把下面两个值换成你自己 Supabase 项目的 Project URL 和 anon public key。
// config.js 不会被 git 忽略——anon key 本来就是设计给前端公开使用的（读权限公开，写权限受 RLS 限制到登录用户），可以放心提交。
window.SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT-REF.supabase.co",
  anonKey: "YOUR-ANON-PUBLIC-KEY",
};

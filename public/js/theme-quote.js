/* ===== MyTime 任务计时器 · 主题 / 每日一言 / 浏览器通知 ===== */
"use strict";

/* ---------- 浏览器通知 ---------- */
function requestNotifyPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: "mytime-cd-" + title });
  } catch (e) {
    console.warn("发送浏览器通知失败", e);
  }
}

/* ---------- 主题切换 ---------- */
const THEME_KEY = "mytime_theme";
function applyTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  els.themeIcon.textContent = dark ? "☀️" : "🌙";
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
}
// 初始化：优先读取本地保存，其次跟随系统偏好（由 main.js 启动时调用）
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

/* ---------- 每日一言 ---------- */
// 内置兜底语录（API 失败时使用），hitokoto 优先
const QUOTE_FALLBACK = [
  { text: "千里之行，始于足下。", from: "老子" },
  { text: "今天能做的事，不要拖到明天。", from: "谚语" },
  { text: "种一棵树最好的时间是十年前，其次是现在。", from: "谚语" },
  { text: "不积跬步，无以至千里。", from: "荀子" },
  { text: "时间是一切财富中最宝贵的财富。", from: "德奥弗拉斯多" },
  { text: "你热爱生命吗？那么别浪费时间。", from: "富兰克林" },
  { text: "业精于勤，荒于嬉。", from: "韩愈" },
  { text: "路漫漫其修远兮，吾将上下而求索。", from: "屈原" },
  { text: "每一个不曾起舞的日子，都是对生命的辜负。", from: "尼采" },
  { text: "莫等闲，白了少年头，空悲切。", from: "岳飞" }
];

function setQuote(text, from) {
  const box = els.dailyQuote;
  const t = els.dqText;
  const f = els.dqFrom;
  if (!box || !t) return;
  if (box.classList.contains("show")) box.classList.remove("show");
  box.classList.add("fade");
  if (f) f.textContent = from || "";
  // 下次重绘后再淡入，保证过渡生效
  requestAnimationFrame(() => {
    t.textContent = text || "";
    requestAnimationFrame(() => {
      box.classList.remove("fade");
      box.classList.add("show");
    });
  });
}

function renderDailyQuote() {
  const CACHE_KEY = "mytime_daily_quote";
  const THROTTLE_MS = 5 * 60 * 1000; // 5 分钟内不重复请求 API

  // 读取本地缓存（含获取时间戳）
  let cached = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch (e) { cached = null; }

  // 命中缓存且未超 5 分钟 -> 直接展示，不请求 API
  if (cached && cached.text && Date.now() - (cached.ts || 0) < THROTTLE_MS) {
    setQuote(cached.text, cached.from);
    return;
  }

  // 真正优先 hitokoto：先清空（淡出），成功才显示 API 内容并写入缓存；
  // 仅 fetch 失败 / 限流 / 超时(2.5s)才回退内置兜底（兜底不写缓存，5 分钟后可重试 API）。
  const box = els.dailyQuote;
  if (box) { box.classList.remove("show"); box.classList.add("fade"); }
  // 请求期间显示占位文本
  setQuote("正在获取每日一言…", "");

  const saveCache = (text, from) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ text, from, ts: Date.now() })); } catch (e) {}
  };

  const useFallback = () => {
    const fb = QUOTE_FALLBACK[Math.floor(Math.random() * QUOTE_FALLBACK.length)];
    setQuote(fb.text, fb.from);
  };

  // 超时兜底：2.5 秒内未返回则显示内置
  let done = false;
  const timer = setTimeout(() => { if (!done) { done = true; useFallback(); } }, 2500);

  fetch("https://v1.hitokoto.cn/", { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
    .then(d => {
      const text = (d.hitokoto || "").trim();
      if (!text) throw new Error("empty");
      const from = [d.from, d.from_who].filter(Boolean).join("·");
      if (!done) {
        done = true; clearTimeout(timer);
        saveCache(text, from);
        setQuote(text, from);
      }
    })
    .catch(() => { if (!done) { done = true; clearTimeout(timer); useFallback(); } });
}

/* ---------- 启动前预热通知状态 ----------
 * 页面打开/刷新时 notifiedIds、cronLastNext 均为空（内存态）。
 * 若此时倒计时已结束、或 cron 在页面关闭期间已越过触发边界，
 * 首次 updateTimers 会误判为「刚结束/刚触发」并重复发通知。
 * 故在首次渲染前预热：已结束的倒计时标记为已通知，cron 预填下次触发指针。 */
function initNotifyState() {
  const now = Date.now();
  tasks.forEach(task => {
    if (task.type === "countdown") {
      const { cls } = computeTimer(task, now);
      if (cls === "is-done") notifiedIds.add(task.id); // 已结束：标记已通知，避免刷新后重复提醒
    } else if (task.type === "cron") {
      computeTimer(task, now); // 预热 cronLastNext，使首次边界检测不会误判为刚触发
    }
  });
}

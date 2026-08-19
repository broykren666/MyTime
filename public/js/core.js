/* ===== MyTime 任务计时器 · 核心常量与通用工具 ===== */
"use strict";

const STORAGE_KEY = "mytime_tasks";
const UNIT_LABEL = { year: "年", month: "月", week: "周", day: "天", hour: "时", minute: "分" };
// 任务类型显示名称（与弹窗内 typeSeg 的 data-type 对应）
const TYPE_LABEL = { countdown: "倒计时", stopwatch: "正计时", birthday: "纪念日", memorial: "倒数日", fixedday: "固定日", cron: "Cron" };
// 任务类型图标（emoji，无需额外依赖，便于快速识别）
const TYPE_ICON = { countdown: "⏳", stopwatch: "🕗", birthday: "🎉", memorial: "🗓️", fixedday: "📌", cron: "🔁" };
// 兼容旧数据：曾经用 "date" 表示固定日期，统一映射为 memorial（纪念）
const TYPE_ALIAS = { date: "memorial" };

// 安全解析 JSON，失败时返回 fallback
function safeParse(raw, fallback) {
  try { const v = JSON.parse(raw); return v == null ? fallback : v; } catch (_) { return fallback; }
}

// 今天日期键 YYYY-M-D（与节假日缓存、渲染使用同一格式）
function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/* 农历显示名称 */
const LUNAR_MONTH_NAMES = ['', '正月','二月','三月','四月','五月','六月','七月','八月','九月','十月','冬月','腊月'];
const LUNAR_DAY_NAMES = ['','初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
  '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
  '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];

function normalizeType(t) {
  return TYPE_ALIAS[t] || t;
}

/* ---------- 通用工具 ---------- */
function todayStr(d) {
  const dt = d instanceof Date ? d : new Date();
  const off = dt.getTimezoneOffset();
  return new Date(dt.getTime() - off * 60000).toISOString().slice(0, 10);
}

function genId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

/* 把日期 + 时间输入拼成本地时间戳；任一无效返回 null */
function anchorTimestamp(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm, ss] = (timeStr || "00:00:00").split(":").map(Number);
  const ts = new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function unitMs(unit, from) {
  const ref = from ? new Date(from) : new Date();
  switch (unit) {
    case "year": {
      const nextYear = new Date(ref.getFullYear() + 1, ref.getMonth(), ref.getDate());
      return nextYear.getTime() - ref.getTime();
    }
    case "month": {
      const nextMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, ref.getDate());
      return nextMonth.getTime() - ref.getTime();
    }
    case "week": return 7 * 24 * 3600 * 1000;
    case "day": return 24 * 3600 * 1000;
    case "hour": return 3600 * 1000;
    case "minute": return 60 * 1000;
    default: return 0;
  }
}

function pad2(n) { return String(n).padStart(2, "0"); }

function formatDateTime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/* ---------- 固定日解析与进度 ---------- */
// 固定日单值合法性：正数 1-28，负数仅 -1/-2/-3
function isValidFixedday(token) {
  if (!/^-?\d+$/.test(token)) return false;
  const n = parseInt(token, 10);
  if (n > 0) return n >= 1 && n <= 28;
  if (n < 0) return n === -1 || n === -2 || n === -3;
  return false; // 0 非法
}

// 解析固定日字符串：拆分、过滤非法、去重、排序（正数升序在前，负数升序在后）
// 兼容旧版本逗号分隔与新版本斜杠分隔
function parseFixeddays(str) {
  const parts = String(str || "").split(/[/,]/).map(s => s.trim()).filter(Boolean);
  const valid = parts.filter(isValidFixedday).map(s => parseInt(s, 10));
  const uniq = [...new Set(valid)];
  uniq.sort((a, b) => {
    const ap = a > 0, bp = b > 0;
    if (ap !== bp) return ap ? -1 : 1; // 正数在前
    return a - b;
  });
  return uniq;
}

// 计算距离下一次「每月 day 日」的天数
// day 为正数：每月 day 日；day 为负数：月末倒数第 |day| 天（如 -1 为月末最后一天）
function nextFixedDay(day, nowTs) {
  const base = new Date(nowTs);
  const y = base.getFullYear();
  const m = base.getMonth();
  const dayMs = 24 * 3600 * 1000;
  // 构造指定月份（monthIndex）的目标日；负数基于该月月末往前倒数，避开负 day 的时区歧义
  function candFor(monthIndex) {
    if (day > 0) return new Date(y, monthIndex, day, 0, 0, 0);
    const firstNext = new Date(y, monthIndex + 1, 1, 0, 0, 0);
    firstNext.setDate(0); // 该月最后一天（本地安全）
    firstNext.setDate(firstNext.getDate() + day + 1); // day 为负，+1 因已为月末倒数第 1 天
    return firstNext;
  }
  let cand = candFor(m);
  let diff = Math.round((cand.getTime() - startOfDay(nowTs)) / dayMs);
  if (diff < 0) {
    cand = candFor(m + 1);
    diff = Math.round((cand.getTime() - startOfDay(nowTs)) / dayMs);
  }
  return { diff, month: cand.getMonth() + 1, date: cand.getDate() };
}

// 按剩余比例（progress，0~1）返回甘特图填充色档（整条单色，按长度分 10 档）：
// 100-90 绿 / 90-80 绿蓝 / 80-70 蓝 / 70-60 蓝黄 / 60-50 黄 /
// 50-40 黄橙 / 40-30 橙 / 30-20 橙红 / 20-10 红 / 10-0 红紫
function progressLevelCls(progress) {
  const p = Math.max(0, Math.min(1, progress));
  if (p > 0.9) return "";            // 绿（基础色）
  if (p > 0.8) return "is-green-blue";
  if (p > 0.7) return "is-blue";
  if (p > 0.6) return "is-blue-yellow";
  if (p > 0.5) return "is-yellow";
  if (p > 0.4) return "is-yellow-orange";
  if (p > 0.3) return "is-orange";
  if (p > 0.2) return "is-orange-red";
  if (p > 0.1) return "is-red";
  return "is-red-purple";            // 红紫
}

// 文本颜色档（5 档，与甘特图主色对应）
function textLevelCls(progress) {
  const p = Math.max(0, Math.min(1, progress));
  if (p > 0.8) return "";
  if (p > 0.6) return "is-blue";
  if (p > 0.4) return "is-yellow";
  if (p > 0.2) return "is-orange";
  return "is-red";
}

/* 星期 */
const WEEK_CN = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];

/* 移动端视口判断（PC 端跳过移动端长按手势，保持鼠标拖放逻辑） */
const isMobileView = () => window.matchMedia("(max-width: 560px)").matches;

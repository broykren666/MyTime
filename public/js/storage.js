/* ===== MyTime 任务计时器 · 数据层 ===== */
"use strict";

/* ---------- 数据层 ---------- */
let tasksDirty = false; // loadTasks 中是否执行了数据迁移

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const rawTasks = data.filter(t => t && typeof t.id === "string");
    let dirty = false;
    const migrated = rawTasks.map(t => {
      const task = { ...t, type: normalizeType(t.type) };
      // 迁移：固定日旧数据可能用逗号分隔，统一规范化为斜杠分隔
      if (task.type === "fixedday" && typeof task.fixeddayValue === "string") {
        const arr = parseFixeddays(task.fixeddayValue);
        const normalized = arr.length ? arr.join("/") : "1";
        if (normalized !== task.fixeddayValue) dirty = true;
        task.fixeddayValue = normalized;
      }
      // 迁移：倒计时任务缺少 createdAt 则补上当前时间，避免每次刷新重置倒计时
      if (task.type === "countdown" && !task.createdAt) {
        task.createdAt = Date.now();
        dirty = true;
      }
      return task;
    });
    tasksDirty = tasksDirty || dirty;
    return migrated;
  } catch (e) {
    console.warn("读取本地数据失败，已重置为空列表", e);
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.error("保存本地数据失败", e);
  }
}

let tasks = loadTasks();
// 加载后若数据被迁移规范化，写回存储以持久化迁移结果
if (tasksDirty) saveTasks();
let editingId = null; // null = 添加模式
const notifiedIds = new Set(); // 已发送过结束通知的倒计时任务 id，避免每秒重复提醒
const cronCache = new Map(); // 缓存 Croner 实例，key 为 cron 表达式
const cronLastNext = new Map(); // 记录每个 cron 任务上次观测到的「下次触发时间」，用于检测触发边界
const timerCells = new Map(); // taskId → 计时器 DOM 元素，避免每次 updateTimers 做 O(n) querySelector

/* ---------- DOM 引用 ---------- */
const els = {
  list: document.getElementById("taskList"),
  empty: document.getElementById("emptyState"),
  addBtn: document.getElementById("addBtn"),
  themeBtn: document.getElementById("themeBtn"),
  themeIcon: document.getElementById("themeIcon"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  dataBtn: document.getElementById("dataBtn"),
  dataModal: document.getElementById("dataModal"),
  dataCount: document.getElementById("dataCount"),
  exportBtn: document.getElementById("exportBtn"),
  importInput: document.getElementById("importInput"),
  importPickBtn: document.getElementById("importPickBtn"),
  importFileName: document.getElementById("importFileName"),
  importBtn: document.getElementById("importBtn"),
  dataMsg: document.getElementById("dataMsg"),
  form: document.getElementById("taskForm"),
  name: document.getElementById("nameInput"),
  typeSeg: document.getElementById("typeSeg"),
  typeLockTip: document.getElementById("typeLockTip"),
  cdField: document.getElementById("countdownField"),
  cdValue: document.getElementById("cdValueInput"),
  unitSeg: document.getElementById("unitSeg"),
  birthdayField: document.getElementById("birthdayField"),
  birthdayInput: document.getElementById("birthdayInput"),
  birthdayCalendarToggle: document.getElementById("birthdayCalendarToggle"),
  birthdayLunarPicker: document.getElementById("birthdayLunarPicker"),
  birthdayLunarYear: document.getElementById("birthdayLunarYear"),
  birthdayLunarMonth: document.getElementById("birthdayLunarMonth"),
  birthdayLunarDay: document.getElementById("birthdayLunarDay"),
  birthdayLunarLeap: document.getElementById("birthdayLunarLeap"),
  memorialField: document.getElementById("memorialField"),
  memorialInput: document.getElementById("memorialInput"),
  memorialCalendarToggle: document.getElementById("memorialCalendarToggle"),
  memorialLunarPicker: document.getElementById("memorialLunarPicker"),
  memorialLunarYear: document.getElementById("memorialLunarYear"),
  memorialLunarMonth: document.getElementById("memorialLunarMonth"),
  memorialLunarDay: document.getElementById("memorialLunarDay"),
  memorialLunarLeap: document.getElementById("memorialLunarLeap"),
  fixeddayField: document.getElementById("fixeddayField"),
  fixeddayInput: document.getElementById("fixeddayInput"),
  cronField: document.getElementById("cronField"),
  cronInput: document.getElementById("cronInput"),
  cronInfo: document.getElementById("cronInfo"),
  anchorSegCountdown: document.getElementById("anchorSegCountdown"),
  anchorDatetimeCountdown: document.getElementById("anchorDatetimeCountdown"),
  anchorDateCountdown: document.getElementById("anchorDateCountdown"),
  anchorTimeCountdown: document.getElementById("anchorTimeCountdown"),
  anchorSegCron: document.getElementById("anchorSegCron"),
  anchorDatetimeCron: document.getElementById("anchorDatetimeCron"),
  anchorDateCron: document.getElementById("anchorDateCron"),
  anchorTimeCron: document.getElementById("anchorTimeCron"),
  stopwatchField: document.getElementById("stopwatchField"),
  anchorSegStopwatch: document.getElementById("anchorSegStopwatch"),
  anchorDatetimeStopwatch: document.getElementById("anchorDatetimeStopwatch"),
  anchorDateStopwatch: document.getElementById("anchorDateStopwatch"),
  anchorTimeStopwatch: document.getElementById("anchorTimeStopwatch"),
  dailyQuote: document.getElementById("dailyQuote"),
  dqText: document.getElementById("dqText"),
  dqFrom: document.getElementById("dqFrom"),
};

/* 分段器 seg-item 缓存，避免 sync*UI 中重复 querySelectorAll */
const segItems = {
  typeItems: els.typeSeg.querySelectorAll(".seg-item"),
  unitItems: els.unitSeg.querySelectorAll(".seg-item"),
  anchorCdnItems: els.anchorSegCountdown.querySelectorAll(".seg-item"),
  anchorCronItems: els.anchorSegCron.querySelectorAll(".seg-item"),
  anchorStopwatchItems: els.anchorSegStopwatch.querySelectorAll(".seg-item"),
};

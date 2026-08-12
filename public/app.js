/* ===== MyTime 任务计时器 · 逻辑层 ===== */
"use strict";

const STORAGE_KEY = "mytime_tasks";
const UNIT_LABEL = { year: "年", month: "月", week: "周", day: "天", hour: "时", minute: "分" };
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

/* 公历/农历切换状态（弹窗内，按类型的临时状态） */
let formCalendarTypeBirthday = "solar";
let formCalendarTypeMemorial = "solar";

/* 锚定模式（倒计时 / Cron 各自的临时状态）：now=此刻，anchored=锚定 */
let formAnchorModeCountdown = "now";
let formAnchorModeCron = "now";

function normalizeType(t) {
  return TYPE_ALIAS[t] || t;
}

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
};

/* 当前表单选择的类型 / 单位（临时状态） */
let formType = "countdown";
let formUnit = "year";

/* ---------- 工具 ---------- */
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

/* ---------- 渲染层 ---------- */
function renderList() {
  timerCells.clear();
  els.empty.hidden = tasks.length > 0;

  // 构建到临时片段，再一次性替换，避免“先清空后重建”导致的刷新闪烁
  const frag = document.createDocumentFragment();

  tasks.forEach((task, i) => {
    const tr = document.createElement("tr");
    tr.dataset.id = task.id;
    tr.draggable = true;

    // 拖拽手柄
    const tdDrag = document.createElement("td");
    tdDrag.className = "col-drag";
    tdDrag.innerHTML = '<span class="drag-handle" title="拖拽排序">⠿</span>';

    // 序号
    const tdIdx = document.createElement("td");
    tdIdx.className = "col-index";
    tdIdx.innerHTML = `<span class="idx-badge">${i + 1}</span>`;

    // 名称
    const tdName = document.createElement("td");
    tdName.className = "cell-name";
    tdName.textContent = task.name;

    // 任务时间（设定值）
    const tdTime = document.createElement("td");
    tdTime.className = "cell-time";
    tdTime.textContent = formatTime(task);

    // 计时器（动态，缓存引用避免每秒 querySelector）
    // 甘特图结构：.gantt-bar 轨道 > .gantt-fill 进度 + 叠放文字
    const tdTimer = document.createElement("td");
    tdTimer.className = "timer-cell";
    tdTimer.dataset.timer = task.id;

    const bar = document.createElement("div");
    bar.className = "gantt-bar";
    const fill = document.createElement("div");
    fill.className = "gantt-fill";
    const label = document.createElement("span");
    label.className = "gantt-label";
    bar.append(fill, label);

    tdTimer.append(bar);
    timerCells.set(task.id, tdTimer);

    // 操作（修改 / 删除）
    const tdOps = document.createElement("td");
    tdOps.className = "col-ops";
    const ops = document.createElement("div");
    ops.className = "ops";

    const edit = opBtn("修改", "修改", false, () => openModal(task.id));
    const del = opBtn("删除", "删除", false, () => removeTask(task.id), true);

    ops.append(edit, del);
    tdOps.appendChild(ops);

    tr.append(tdDrag, tdIdx, tdName, tdTime, tdTimer, tdOps);
    frag.appendChild(tr);
  });

  els.list.replaceChildren(frag);
  bindDragSort();
  updateTimers();
  revealTable();
}

// 首屏：列表真正渲染完成后才显示表格区，避免「空列表闪一下」
let _tableRevealed = false;
function revealTable() {
  if (_tableRevealed) return;
  _tableRevealed = true;
  const wrap = els.list.closest(".table-wrap");
  if (wrap) {
    wrap.classList.remove("preload");
    wrap.classList.add("revealed");
  }
}

/* 拖拽排序：绑定行的拖放事件 */
let dragFrom = null;
function bindDragSort() {
  const rows = els.list.querySelectorAll("tr");
  rows.forEach(row => {
    row.addEventListener("dragstart", e => {
      dragFrom = row.dataset.id;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragFrom);
    });
    row.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (row.dataset.id !== dragFrom) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", e => {
      e.preventDefault();
      const dragTo = row.dataset.id;
      if (dragTo && dragTo !== dragFrom) moveTask(dragFrom, dragTo);
      row.classList.remove("drag-over");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      rows.forEach(r => r.classList.remove("drag-over"));
      dragFrom = null;
    });
  });
}

/* 按 id 将任务从 from 移动到 to 的位置 */
function moveTask(fromId, toId) {
  const from = tasks.findIndex(t => t.id === fromId);
  const to = tasks.findIndex(t => t.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [item] = tasks.splice(from, 1);
  tasks.splice(to, 0, item);
  saveTasks();
  renderList();
}

function opBtn(label, title, disabled, onClick, danger) {
  const b = document.createElement("button");
  b.className = "op-btn" + (danger ? " danger" : "");
  b.textContent = label;
  b.title = title;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function formatTime(task) {
  if (task.type === "countdown") return `${task.cdValue} ${UNIT_LABEL[task.cdUnit] || ""}`;
  if (task.type === "birthday") return formatBirthdayTime(task);
  if (task.type === "cron") return task.cronValue || "—";
  if (task.type === "fixedday") {
    return `每月 ${task.fixeddayValue || "1"} 日`;
  }
  return formatMemorialTime(task);
}

/* 格式化纪念日/倒数日的日期展示 */
function formatBirthdayTime(task) {
  if (task.calendarType === "lunar") {
    const monthName = LUNAR_MONTH_NAMES[task.lunarMonth] || "";
    const dayName = LUNAR_DAY_NAMES[task.lunarDay] || "";
    const leap = task.lunarLeap ? "闰" : "";
    const refYear = getReferenceYear(task);
    return refYear ? `${leap}${monthName}${dayName}（${refYear}年）` : `${leap}${monthName}${dayName}`;
  }
  return task.birthdayValue || "—";
}

function formatMemorialTime(task) {
  if (task.calendarType === "lunar") {
    const monthName = LUNAR_MONTH_NAMES[task.lunarMonth] || "";
    const dayName = LUNAR_DAY_NAMES[task.lunarDay] || "";
    const leap = task.lunarLeap ? "闰" : "";
    return `${leap}${monthName}${dayName}`;
  }
  return task.memorialValue || "—";
}

function ymdStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- 顺序调整 / 删除 ---------- */
function removeTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (!confirm(`确定删除任务「${task.name}」吗？`)) return;
  tasks = tasks.filter(t => t.id !== id);
  notifiedIds.delete(id);
  saveTasks();
  renderList();
}

/* ---------- 弹窗 ---------- */
function openModal(id) {
  editingId = id || null;
  els.form.reset();

  // 初始化农历下拉框（仅首次）
  initLunarSelects();
  // 重置农历选择状态
  const nowYear = new Date().getFullYear();
  els.birthdayLunarYear.value = String(nowYear);
  els.birthdayLunarMonth.value = "1";
  els.birthdayLunarDay.value = "1";
  els.birthdayLunarLeap.classList.remove("is-active");
  els.memorialLunarYear.value = String(nowYear);
  els.memorialLunarMonth.value = "1";
  els.memorialLunarDay.value = "1";
  els.memorialLunarLeap.classList.remove("is-active");
  formCalendarTypeBirthday = "solar";
  formCalendarTypeMemorial = "solar";

  if (editingId) {
    const task = tasks.find(t => t.id === editingId);
    if (!task) return;
    els.modalTitle.textContent = "修改任务";
    els.name.value = task.name;
    formType = task.type;
    if (task.type === "countdown") {
      formUnit = task.cdUnit;
      els.cdValue.value = task.cdValue;
      formAnchorModeCountdown = task.anchor ? "anchored" : "now";
      const ad = task.anchor ? new Date(task.anchor) : new Date();
      els.anchorDateCountdown.value = todayStr(ad);
      els.anchorTimeCountdown.value = ad.toTimeString().slice(0, 8);
    } else if (task.type === "birthday") {
      if (task.calendarType === "lunar") {
        formCalendarTypeBirthday = "lunar";
        els.birthdayLunarYear.value = task.lunarYear || String(nowYear);
        els.birthdayLunarMonth.value = task.lunarMonth || 1;
        els.birthdayLunarDay.value = task.lunarDay || 1;
        els.birthdayLunarLeap.classList.toggle("is-active", task.lunarLeap);
      }
      els.birthdayInput.value = task.birthdayValue || todayStr();
    } else if (task.type === "fixedday") {
      els.fixeddayInput.value = task.fixeddayValue;
      onFixeddayInput();
    } else if (task.type === "cron") {
      els.cronInput.value = task.cronValue;
      formAnchorModeCron = task.anchor ? "anchored" : "now";
      const ad = task.anchor ? new Date(task.anchor) : new Date();
      els.anchorDateCron.value = todayStr(ad);
      els.anchorTimeCron.value = ad.toTimeString().slice(0, 8);
    } else {
      if (task.calendarType === "lunar") {
        formCalendarTypeMemorial = "lunar";
        els.memorialLunarYear.value = task.lunarYear || String(nowYear);
        els.memorialLunarMonth.value = task.lunarMonth || 1;
        els.memorialLunarDay.value = task.lunarDay || 1;
        els.memorialLunarLeap.classList.toggle("is-active", task.lunarLeap);
      }
      els.memorialInput.value = task.memorialValue || todayStr();
    }
    els.typeLockTip.hidden = false;
  } else {
    els.modalTitle.textContent = "添加任务";
    formType = "countdown";
    formUnit = "year";
    els.cdValue.value = 1;
    els.birthdayInput.value = todayStr();
    els.memorialInput.value = todayStr();
    els.fixeddayInput.value = "1";
    els.cronInput.value = "0 8 * * *";
    els.typeLockTip.hidden = true;
    // 锚定模式默认「此刻」，起始时刻框预填此刻
    formAnchorModeCountdown = "now";
    formAnchorModeCron = "now";
    const now = new Date();
    const nowDate = todayStr(now);
    const nowTime = now.toTimeString().slice(0, 8);
    els.anchorDateCountdown.value = nowDate;
    els.anchorTimeCountdown.value = nowTime;
    els.anchorDateCron.value = nowDate;
    els.anchorTimeCron.value = nowTime;
  }

  els.modal.hidden = false;
  syncTypeUI();
  syncUnitUI();
  refreshCronInfo();
}

function closeModal() {
  els.modal.hidden = true;
  editingId = null;
}

/* ---------- 农历选择器初始化 ---------- */
function initLunarSelects() {
  // 年份选项：1900-2100
  for (const sel of [els.birthdayLunarYear, els.memorialLunarYear]) {
    if (sel.options.length === 0) {
      for (let y = 1900; y <= 2100; y++) {
        sel.add(new Option(y + "年", y));
      }
    }
  }
  // 月份选项：1-12
  for (const sel of [els.birthdayLunarMonth, els.memorialLunarMonth]) {
    if (sel.options.length === 0) {
      for (let i = 1; i <= 12; i++) {
        sel.add(new Option(LUNAR_MONTH_NAMES[i], i));
      }
    }
  }
  // 日期选项：先填 1-30，随后由 refreshLunarDays 按实际月天数裁剪
  for (const sel of [els.birthdayLunarDay, els.memorialLunarDay]) {
    if (sel.options.length === 0) {
      for (let i = 1; i <= 30; i++) {
        sel.add(new Option(LUNAR_DAY_NAMES[i], i));
      }
    }
  }
  // 依据当前选择的年月（含闰月）实时调整日子范围
  refreshLunarDays("birthday");
  refreshLunarDays("memorial");
}

/* 根据所选农历年/月/闰月，重算该月实际天数，并裁剪日子下拉框选项。
 * 农历小月为 29 天、大月 30 天；所选月不存在（如闰月当年无此闰月）则回退普通月。 */
function refreshLunarDays(prefix) {
  const yearSel = els[prefix + "LunarYear"];
  const monthSel = els[prefix + "LunarMonth"];
  const daySel = els[prefix + "LunarDay"];
  const leap = els[prefix + "LunarLeap"].classList.contains("is-active");
  if (!yearSel || !monthSel || !daySel) return;
  const y = parseInt(yearSel.value, 10) || new Date().getFullYear();
  const m = parseInt(monthSel.value, 10) || 1;

  let dayCount = 30;
  try {
    const ly = LunarYear.fromYear(y);
    if (leap && ly.getLeapMonth() === m) {
      // 选中闰月且该年确有此闰月
      const months = ly.getMonths();
      const lm = months.find(mo => mo.getYear() === y && mo.getMonth() === m && mo.isLeap());
      dayCount = lm ? lm.getDayCount() : 30;
    } else {
      const lm = ly.getMonth(m);
      dayCount = lm ? lm.getDayCount() : 30;
    }
  } catch (e) {
    dayCount = 30;
  }

  const prevDay = parseInt(daySel.value, 10) || 1;
  // 重建日子选项（仅保留合法范围）
  daySel.options.length = 0;
  for (let i = 1; i <= dayCount; i++) {
    daySel.add(new Option(LUNAR_DAY_NAMES[i], i));
  }
  // 保持原选择（若超出范围则取最大合法值）
  daySel.value = String(Math.min(prevDay, dayCount));
}

/* 切换公历/农历输入面板 */
function syncCalendarTypeUI(prefix) {
  const isLunar = prefix === "birthday" ? formCalendarTypeBirthday === "lunar" : formCalendarTypeMemorial === "lunar";
  const toggle   = els[prefix + "CalendarToggle"];
  const dateInput = els[prefix + "Input"];
  const lunarPicker = els[prefix + "LunarPicker"];

  // 更新按钮状态
  toggle.querySelectorAll(".seg-item").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.cal === (isLunar ? "lunar" : "solar"));
  });
  // 切换输入面板
  dateInput.hidden = isLunar;
  lunarPicker.hidden = !isLunar;
}

/* 农历年月日 → 公历 Date 对象（当天 00:00:00）。失败返回 null。
 * 注：此版 lunar-javascript 的 fromYmd 不支持显式闰月参数，
 * 闰月情况通过 LunarYear.getLeapMonth() 辅助处理，如当年无对应闰月则使用普通月 */
function solarFromLunar(lunarYear, lunarMonth, lunarDay, lunarLeap) {
  try {
    // v1.7.7 的 Lunar.fromYmd 不直接支持闰月参数，通过 LunarYear 来定位闰月
    const lunar = Lunar.fromYmd(lunarYear, lunarMonth, lunarDay);

    if (lunarLeap) {
      // 如果该年有对应闰月，尝试从 months 中找到闰月并计算
      try {
        const ly = LunarYear.fromYear(lunarYear);
        const actualLeap = ly.getLeapMonth();
        if (actualLeap === lunarMonth) {
          const months = ly.getMonths();
          for (let i = 0; i < months.length; i++) {
            const m = months[i];
            if (m.getYear() === lunarYear && m.getMonth() === lunarMonth && m.isLeap()) {
              const jd = m.getFirstJulianDay() + (lunarDay - 1);
              const sd = Solar.fromJulianDay(jd);
              return new Date(sd.getYear(), sd.getMonth() - 1, sd.getDay(), 0, 0, 0);
            }
          }
        }
      } catch (_) { /* 回退到普通月 */ }
    }

    const solar = lunar.getSolar();
    return new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay(), 0, 0, 0);
  } catch (_) {
    return null;
  }
}

/* 获取下一次农历日期对应的公历时间戳（毫秒） */
function nextLunarOccurrence(lunarMonth, lunarDay, lunarLeap, nowTs) {
  const now = new Date(nowTs);
  const thisYear = now.getFullYear();
  // 当年
  let solar = solarFromLunar(thisYear, lunarMonth, lunarDay, lunarLeap);
  if (solar && solar.getTime() > startOfDay(nowTs)) {
    return solar.getTime();
  }
  // 明年
  solar = solarFromLunar(thisYear + 1, lunarMonth, lunarDay, lunarLeap);
  if (solar) return solar.getTime();
  // 极端情况回退：再往后一年
  solar = solarFromLunar(thisYear + 2, lunarMonth, lunarDay, lunarLeap);
  return solar ? solar.getTime() : null;
}

/* 获取纪念日基准年份（用于"X年"显示） */
function getReferenceYear(task) {
  if (task.calendarType === "lunar" && task.lunarYear) return task.lunarYear;
  if (task.birthdayValue) {
    const d = new Date(task.birthdayValue);
    if (!isNaN(d.getTime())) return d.getFullYear();
  }
  return null;
}

/* ---------- Cron 实时解析 ---------- */
function pad2(n) { return String(n).padStart(2, "0"); }

function formatDateTime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function refreshCronInfo() {
  const info = els.cronInfo;
  const expr = els.cronInput.value.trim();
  if (!expr) { info.hidden = true; return; }
  if (typeof Cron === "undefined") {
    info.innerHTML = `<div class="cron-desc">Cron 库加载失败，请检查网络连接</div>`;
    info.className = "cron-info cron-err";
    info.hidden = false;
    return;
  }
  try {
    const c = new Cron(expr);
    const next = c.nextRun();
    if (!next) { info.hidden = true; return; }
    info.innerHTML = `<div class="cron-next">下次触发：${formatDateTime(next)}</div>`;
    info.className = "cron-info cron-ok";
    info.hidden = false;
    // 刷新缓存供 computeTimer 复用
    cronCache.set(expr, c);
  } catch (e) {
    info.innerHTML = `<div class="cron-desc">${e.message || "表达式无效"}</div>`;
    info.className = "cron-info cron-err";
    info.hidden = false;
  }
}

/* ---------- 数据管理弹窗 ---------- */
let pendingImport = null; // 待导入的已解析任务数组

function openDataModal() {
  els.dataCount.textContent = tasks.length;
  pendingImport = null;
  els.importInput.value = "";
  els.importFileName.textContent = "";
  hideDataMsg();
  els.dataModal.hidden = false;
}

function closeDataModal() {
  els.dataModal.hidden = true;
}

function showDataMsg(text, ok) {
  els.dataMsg.textContent = text;
  els.dataMsg.className = "data-msg " + (ok ? "is-ok" : "is-err");
  els.dataMsg.hidden = false;
}
function hideDataMsg() {
  els.dataMsg.hidden = true;
  els.dataMsg.textContent = "";
}

function exportData() {
  const payload = JSON.stringify(tasks, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `mytime-tasks-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showDataMsg(`已导出 ${tasks.length} 条任务`, true);
}

function onImportFilePicked(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error("文件内容不是任务数组");
      const valid = data
        .filter(t => t && typeof t.id === "string")
        .map(t => ({ ...t, type: normalizeType(t.type) }));
      pendingImport = valid;
      els.importFileName.textContent = `${file.name}（${valid.length} 条）`;
      if (valid.length === 0) {
        showDataMsg("文件中没有有效的任务数据", false);
      } else {
        hideDataMsg();
      }
    } catch (e) {
      pendingImport = null;
      els.importFileName.textContent = "";
      showDataMsg("解析失败：" + e.message, false);
    }
  };
  reader.onerror = () => {
    pendingImport = null;
    showDataMsg("读取文件失败", false);
  };
  reader.readAsText(file);
}

function doImport() {
  if (!pendingImport || pendingImport.length === 0) {
    showDataMsg("请先选择要导入的 JSON 文件", false);
    return;
  }
  const n = pendingImport.length;
  if (!confirm(`确定用选中的 ${n} 条数据覆盖当前全部 ${tasks.length} 条数据吗？此操作不可撤销。`)) return;
  tasks = pendingImport.map(t => ({ ...t }));
  saveTasks();
  renderList();
  els.dataCount.textContent = tasks.length;
  pendingImport = null;
  els.importInput.value = "";
  els.importFileName.textContent = "";
  showDataMsg(`已导入并覆盖 ${n} 条任务`, true);
}

function syncTypeUI() {
  const locked = editingId !== null; // 修改模式锁定任务类型
  segItems.typeItems.forEach(b => {
    b.classList.toggle("is-active", b.dataset.type === formType);
    b.disabled = locked;
  });
  // 根据任务类型动态显示对应输入区，隐藏其它（hidden 属性 + 淡入过渡）
  const fieldKey = { countdown: "cd", birthday: "birthday", memorial: "memorial", fixedday: "fixedday", cron: "cron" };
  const show = type => {
    const el = els[fieldKey[type] + "Field"];
    el.hidden = formType !== type;
    el.classList.toggle("is-shown", formType === type);
  };
  show("countdown");
  show("birthday");
  show("memorial");
  show("fixedday");
  show("cron");
  // 禁用隐藏区字段，避免浏览器校验到隐藏的必填框
  els.cdValue.disabled = formType !== "countdown";
  segItems.unitItems.forEach(b => (b.disabled = formType !== "countdown"));
  els.birthdayInput.disabled = formType !== "birthday";
  els.memorialInput.disabled = formType !== "memorial";
  els.fixeddayInput.disabled = formType !== "fixedday";
  els.cronInput.disabled = formType !== "cron";
  // 同步农历面板
  syncCalendarTypeUI("birthday");
  syncCalendarTypeUI("memorial");
  // 同步锚定（此刻/锚定）面板
  syncAnchorUI();
}

function syncUnitUI() {
  segItems.unitItems.forEach(b =>
    b.classList.toggle("is-active", b.dataset.unit === formUnit)
  );
}

/* 同步锚定分段器高亮，并按类型显隐对应的起始时刻框 */
function syncAnchorUI() {
  const segMap = { countdown: segItems.anchorCdnItems, cron: segItems.anchorCronItems };
  const boxMap = { countdown: els.anchorDatetimeCountdown, cron: els.anchorDatetimeCron };
  ["countdown", "cron"].forEach(type => {
    const items = segMap[type];
    const mode = type === "countdown" ? formAnchorModeCountdown : formAnchorModeCron;
    items.forEach(b =>
      b.classList.toggle("is-active", b.dataset.anchor === mode)
    );
    const box = boxMap[type];
    const visible = formType === type && mode === "anchored";
    box.hidden = !visible;
    // 仅当前类型且锚定时启用日期框，避免隐藏必填校验问题
    const dateEl = type === "countdown" ? els.anchorDateCountdown : els.anchorDateCron;
    const timeEl = type === "countdown" ? els.anchorTimeCountdown : els.anchorTimeCron;
    dateEl.disabled = !visible;
    timeEl.disabled = !visible;
  });
}

function submitTask(e) {
  e.preventDefault();
  const name = els.name.value.trim();
  if (!name) return;

  const base = {
    name,
    type: formType,
  };

  if (formType === "countdown") {
    const val = Math.max(1, parseInt(els.cdValue.value, 10) || 1);
    base.cdValue = val;
    base.cdUnit = formUnit;
    base.createdAt = Date.now();
    // 锚定模式（此刻=不写 anchor，沿用 createdAt；锚定=起始时刻）
    if (formAnchorModeCountdown === "anchored") {
      const ts = anchorTimestamp(els.anchorDateCountdown.value, els.anchorTimeCountdown.value);
      if (ts !== null) base.anchor = ts;
    }
  } else if (formType === "birthday") {
    base.calendarType = formCalendarTypeBirthday;
    if (formCalendarTypeBirthday === "lunar") {
      base.lunarYear = parseInt(els.birthdayLunarYear.value, 10) || new Date().getFullYear();
      base.lunarMonth = parseInt(els.birthdayLunarMonth.value, 10) || 1;
      base.lunarDay = parseInt(els.birthdayLunarDay.value, 10) || 1;
      base.lunarLeap = els.birthdayLunarLeap.classList.contains("is-active");
      // 基准日：用户选择年份的农历 → 公历转换，用于年份计数
      const sd = solarFromLunar(base.lunarYear, base.lunarMonth, base.lunarDay, base.lunarLeap);
      base.birthdayValue = sd ? ymdStr(sd) : todayStr();
    } else {
      base.birthdayValue = els.birthdayInput.value || todayStr();
    }
  } else if (formType === "fixedday") {
    const arr = parseFixeddays(els.fixeddayInput.value);
    if (arr.length === 0) { alert("固定日输入无效，请输入 1-28、-1、-2、-3，多个用/分隔"); return; }
    base.fixeddayValue = arr.join("/");
  } else if (formType === "cron") {
    const val = els.cronInput.value.trim();
    if (!val) { alert("请输入 Cron 表达式"); return; }
    if (typeof Cron !== "undefined") {
      try { new Cron(val); } catch (_) { alert("Cron 表达式无效"); return; }
    }
    base.cronValue = val;
    // 锚定模式（此刻=不写 anchor；锚定=时间轴原点，用于周期对齐与补跑判断）
    if (formAnchorModeCron === "anchored") {
      const ts = anchorTimestamp(els.anchorDateCron.value, els.anchorTimeCron.value);
      if (ts !== null) base.anchor = ts;
    }
  } else {
    base.calendarType = formCalendarTypeMemorial;
    if (formCalendarTypeMemorial === "lunar") {
      base.lunarYear = parseInt(els.memorialLunarYear.value, 10) || new Date().getFullYear();
      base.lunarMonth = parseInt(els.memorialLunarMonth.value, 10) || 1;
      base.lunarDay = parseInt(els.memorialLunarDay.value, 10) || 1;
      base.lunarLeap = els.memorialLunarLeap.classList.contains("is-active");
      const sd = solarFromLunar(base.lunarYear, base.lunarMonth, base.lunarDay, base.lunarLeap);
      base.memorialValue = sd ? ymdStr(sd) : todayStr();
    } else {
      base.memorialValue = els.memorialInput.value || todayStr();
    }
  }

  if (editingId) {
    const idx = tasks.findIndex(t => t.id === editingId);
    if (idx !== -1) {
      const merged = { ...tasks[idx], ...base };
      // 切换到「此刻」模式时清除旧的锚定时间，回到以保存时刻为起点
      if (formType === "countdown" && formAnchorModeCountdown === "now") delete merged.anchor;
      if (formType === "cron" && formAnchorModeCron === "now") delete merged.anchor;
      tasks[idx] = merged;
    }
    if (formType === "countdown") notifiedIds.delete(editingId);
  } else {
    const id = genId();
    tasks.push({ id, ...base });
    if (formType === "countdown") notifiedIds.delete(id);
  }

  // 保存/添加即代表用户明确交互，借此请求通知权限
  requestNotifyPermission();
  saveTasks();
  renderList();
  closeModal();
}

/* ---------- 计时器 ---------- */
function updateTimers() {
  const now = Date.now();
  tasks.forEach(task => {
    const cell = timerCells.get(task.id);
    if (!cell) return;
    const { text, cls, progress } = computeTimer(task, now);
    const textCls = textLevelCls(progress);

    // 兼容异常任务（progress 为 null）：回退纯文字显示，不渲染进度条
    if (progress === null || progress === undefined) {
      cell.className = "timer-cell" + (textCls ? " " + textCls : "");
      cell.textContent = text;
      return;
    }

    const bar = cell.querySelector(".gantt-bar");
    const fill = cell.querySelector(".gantt-fill");
    const label = cell.querySelector(".gantt-label");

    cell.className = "timer-cell has-gantt" + (textCls ? " " + textCls : "");
    // 甘特图整条按剩余比例取单色（10 档），从右锚定、随剩余变窄
    fill.className = "gantt-fill" + (cls ? " " + cls : "");
    fill.style.width = (progress * 100).toFixed(2) + "%";
    label.textContent = text;

    // 倒计时结束：发送一次浏览器通知
    if (task.type === "countdown" && cls === "is-done" && !notifiedIds.has(task.id)) {
      notifiedIds.add(task.id);
      notify(task.name, "倒计时已结束");
    }
    // Cron 触发通知已在 computeTimer 内通过「下次触发指针推进」检测并发送，此处不再处理
  });
}

// 进度条进度计算辅助：在 [from, to] 区间内的占比，clamp 到 0~1
function progressBetween(from, to, now) {
  if (to <= from) return 1;
  const p = (now - from) / (to - from);
  return Math.max(0, Math.min(1, p));
}

// 求上一次「每年此日」occur 的 0 点（用于纪念日进度条起点）
function prevAnnualOccurrence(nextTs, nowTs) {
  // nextTs 为下一发生点；上一发生点约为一年前同日 0 点
  const d = new Date(nextTs);
  const prev = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), 0, 0, 0);
  return prev.getTime();
}

function computeTimer(task, now) {
  if (task.type === "countdown") {
    // 有锚定时以 anchor 为起点，否则以 createdAt（保存时刻=此刻）为起点
    const start = task.anchor || task.createdAt || now;
    const end = start + task.cdValue * unitMs(task.cdUnit, start);
    const total = task.cdValue * unitMs(task.cdUnit, start) || 1;
    const remain = end - now;
    if (remain <= 0) return { text: "已结束", cls: "is-done", progress: 0, targetLabel: fmtDate(end) };

    // 进度 = 剩余占比（从左往右随时间递减）
    const progress = Math.max(0, Math.min(1, (end - now) / (end - start)));
    return {
      text: fmtCountdown(remain),
      cls: progressLevelCls(progress),
      progress,
      targetLabel: fmtDate(end) + (task.anchor ? " · 起 " + fmtDate(start) : "")
    };
  }

  if (task.type === "birthday") {
    // 农历纪念日
    if (task.calendarType === "lunar") {
      const nextTs = nextLunarOccurrence(task.lunarMonth, task.lunarDay, task.lunarLeap, now);
      if (!nextTs) return { text: "日期不合法", cls: "is-over", progress: null, targetLabel: "" };
      const diffDays = Math.round((nextTs - startOfDay(now)) / (24 * 3600 * 1000));
      const refYear = getReferenceYear(task);
      // 纪念日「X年」= 已过去的农历周年数。
      // 用 nextTs 对应的【农历年份】减去基准年再减 1（nextTs 是下一个还没到的周年）。
      // 若用公历年份，腊月等跨公历年的情况会虚增一年（如 2026腊月→公历2027，误显 1年）。
      let yLabel = "";
      if (refYear) {
        const nextLunarYear = Lunar.fromDate(new Date(nextTs)).getYear();
        const yearsPassed = nextLunarYear - refYear - 1;
        if (yearsPassed > 0) yLabel = `${yearsPassed}年 | `;
      }
      if (diffDays === 0) return { text: `${yLabel}🎉纪念日快乐`, cls: "is-red", progress: 0, targetLabel: fmtDate(nextTs) };
      const progress = 1 - progressBetween(prevAnnualOccurrence(nextTs, now), nextTs, now);
      return {
        text: `${yLabel}${fmtCountdown(nextTs - now)}`,
        cls: progressLevelCls(progress),
        progress,
        targetLabel: fmtDate(nextTs)
      };
    }
    // 公历纪念日
    const born = new Date((task.birthdayValue || todayStr()) + "T00:00:00");
    const years = (now - born.getTime()) / unitMs("year", now);
    const yLabel = years >= 1 ? `${Math.floor(years)}年 | ` : "";
    const next = nextBirthday(born, now);
    const nextTs = next.nextTs;
    if (next.diff === 0) return { text: `${yLabel}🎉纪念日快乐`, cls: "is-red", progress: 0, targetLabel: fmtDate(nextTs) };
    const progress = 1 - progressBetween(prevAnnualOccurrence(nextTs, now), nextTs, now);
    return {
      text: `${yLabel}${fmtCountdown(nextTs - now)}`,
      cls: progressLevelCls(progress),
      progress,
      targetLabel: fmtDate(nextTs)
    };
  }

  if (task.type === "fixedday") {
    const days = parseFixeddays(task.fixeddayValue);
    if (days.length === 0) return { text: "未设置有效日期", cls: "", progress: null, targetLabel: "" };
    let best = null;
    days.forEach(d => {
      const r = nextFixedDay(d, now);
      if (!best || r.diff < best.diff) best = { ...r, day: d };
    });
    const nextTs = new Date(new Date(now).getFullYear(), best.month - 1, best.date, 0, 0, 0).getTime();
    // 月内周期：起点 = 本月 1 日 0 点，终点 = 目标日 0 点，进度 = 剩余天数占比
    const monthStartTs = new Date(new Date(now).getFullYear(), best.month - 1, 1, 0, 0, 0).getTime();
    if (best.diff === 0) return { text: `今天就是（${best.month}月${best.date}日）`, cls: "is-red", progress: 0, targetLabel: `${best.month}月${best.date}日` };
    const progress = 1 - progressBetween(monthStartTs, nextTs, now);
    return {
      text: `${best.month}月${best.date}日 | ${fmtCountdown(nextTs - now)}`,
      cls: progressLevelCls(progress),
      progress,
      targetLabel: `${best.month}月${best.date}日`
    };
  }

  if (task.type === "cron") {
    const expr = task.cronValue || "";
    if (!expr.trim()) return { text: "未设置表达式", cls: "", progress: null, targetLabel: "" };
    if (typeof Cron === "undefined") return { text: "库未加载", cls: "is-over", progress: null, targetLabel: "" };
    let cronInst = cronCache.get(expr);
    if (!cronInst) {
      try {
        cronInst = new Cron(expr);
        cronCache.set(expr, cronInst);
      } catch (e) {
        return { text: "表达式无效", cls: "is-over", progress: null, targetLabel: "" };
      }
    }
    const next = cronInst.nextRun();
    if (!next) return { text: "无匹配时间", cls: "is-over", progress: null, targetLabel: "" };
    // 触发检测：croner 的 nextRun() 永远返回未来时间，不会返回 <=now 的「已触发」态。
    // 因此用「下次触发指针」是否向前推进来判断一个周期是否刚结束/刚触发。
    const nextTs = next.getTime();
    const lastNextTs = cronLastNext.get(task.id);
    if (lastNextTs !== undefined && nextTs > lastNextTs + 100) {
      // 指针跳过了至少一个边界 → 刚触发一次，发一次通知（不重复）
      if (!notifiedIds.has(task.id)) {
        notifiedIds.add(task.id);
        notify(task.name, "Cron 任务已触发");
      }
    } else if (nextTs <= lastNextTs + 100) {
      // 仍在同一周期内，清除已通知标记以便下次触发可再次提醒
      notifiedIds.delete(task.id);
    }
    cronLastNext.set(task.id, nextTs);
    const remain = nextTs - now;
    if (remain <= 0) return { text: "已触发", cls: "is-red", progress: 0, targetLabel: "Cron" };
    // 用「下一个触发点」与「下下个触发点」反推周期长度，得到当前周期起点（上一个触发点）
    // 不依赖库是否提供 prevRun（croner 无此方法），避免进度长期满格的 bug
    let period = remain;
    try {
      const next2 = cronInst.nextRun(new Date(next.getTime() + 1));
      if (next2) period = Math.max(1, next2.getTime() - next.getTime());
    } catch (e) { /* 退化用 remain */ }
    const prevTs = next.getTime() - period;
    const progress = 1 - progressBetween(prevTs, next.getTime(), now);
    // 锚定时：周期序号从 anchor 起算，直观体现锚定效果
    let prefix = "";
    if (task.anchor) {
      const n = Math.floor(Math.max(0, now - task.anchor) / period) + 1;
      prefix = `#${n} `;
    }
    return {
      text: prefix + fmtCountdown(remain),
      cls: progressLevelCls(progress),
      progress,
      targetLabel: "Cron" + (task.anchor ? " · 锚 " + fmtDate(task.anchor) : "")
    };
  }

  // 倒数日（固定目标日期，可过去可未来）
  if (task.type === "memorial") {
    let target = new Date((task.memorialValue || todayStr()) + "T00:00:00").getTime();
    // 农历倒数日：优先倒数到用户设置的农历年份；未设置时自动取下一个发生点
    if (task.calendarType === "lunar") {
      const nowDate = new Date(now);
      if (task.lunarYear && !isNaN(parseInt(task.lunarYear, 10))) {
        const ySolar = solarFromLunar(parseInt(task.lunarYear, 10), task.lunarMonth, task.lunarDay, task.lunarLeap);
        if (ySolar) target = ySolar.getTime();
      } else {
        const thisYearSolar = solarFromLunar(nowDate.getFullYear(), task.lunarMonth, task.lunarDay, task.lunarLeap);
        if (thisYearSolar && thisYearSolar.getTime() >= startOfDay(now)) {
          target = thisYearSolar.getTime();
        } else {
          const nextYearSolar = solarFromLunar(nowDate.getFullYear() + 1, task.lunarMonth, task.lunarDay, task.lunarLeap);
          target = nextYearSolar ? nextYearSolar.getTime() : target;
        }
      }
    }
    const diff = target - now;
    const days = Math.floor(Math.abs(diff) / (24 * 3600 * 1000));
    if (diff >= 0) {
      if (days === 0) return { text: "今天到期", cls: "is-red", progress: 0, targetLabel: fmtDate(target) };
      // 以「一年前到目标日」为一个周期估算进度
      const from = target - unitMs("year", target);
      const progress = 1 - progressBetween(from, target, now);
      return { text: fmtCountdown(target - now), cls: progressLevelCls(progress), progress, targetLabel: fmtDate(target) };
    }
    return { text: `已过期 ${days}天`, cls: "is-over", progress: 0, targetLabel: fmtDate(target) };
  }
  return { text: "", cls: "", progress: null, targetLabel: "" };
}

// 时间戳 -> "YYYY-MM-DD" 短日期
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 剩余毫秒 -> "xY xD xH xM xS"（英文缩写，统一计时器文本）
function fmtCountdown(remain) {
  let r = Math.max(0, remain);
  const y = Math.floor(r / unitMs("year")); r -= y * unitMs("year");
  const d = Math.floor(r / unitMs("day")); r -= d * unitMs("day");
  const h = Math.floor(r / unitMs("hour")); r -= h * unitMs("hour");
  const m = Math.floor(r / unitMs("minute")); r -= m * unitMs("minute");
  const s = Math.floor(r / 1000);
  const parts = [];
  if (y > 0) parts.push(`${y}y`);
  if (d > 0 || y > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0 || y > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0 || y > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
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

// 固定日输入框实时校验：仅允许 1-28、-1、-2、-3 相关字符，超限自动收敛
function onFixeddayInput() {
  const raw = els.fixeddayInput.value;
  const tokens = raw.split("/");
  const trailingSlash = tokens.length > 1 && tokens[tokens.length - 1] === ""; // 末尾斜杠：正在输入下一段
  const leadingSlash = tokens.length > 1 && tokens[0] === "";                  // 开头斜杠：清理时再处理
  const out = tokens.map(t => {
    let s = t.trim().replace(/[^-0-9]/g, ""); // 仅保留数字与负号
    if (s.indexOf("-") > 0) s = s.replace(/-/g, ""); // 负号只允许开头
    if (s.startsWith("-")) s = "-" + s.slice(1).replace(/-/g, "");
    if (s === "") return null; // 空段丢弃（尾随/开头斜杠单独处理）
    if (s === "-") return "-"; // 孤立负号：正在输入负数，保留
    let n = parseInt(s, 10);
    if (n > 28) n = 28;
    if (n < -3) n = -3;
    return String(n);
  }).filter(x => x !== null);
  let newVal = out.join("/");
  if (trailingSlash) newVal += "/";                                  // 输入中保留尾随斜杠
  if (leadingSlash && out.length) newVal = "/" + newVal;
  if (newVal !== raw) els.fixeddayInput.value = newVal;
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

// 计算距离下一次生日的天数（今年若已过则取明年）
function nextBirthday(born, nowTs) {
  const y = new Date(nowTs).getFullYear();
  let next = new Date(y, born.getMonth(), born.getDate(), 0, 0, 0);
  // 当前时刻与今年生日的零点差值（天）
  let diffDays = Math.round((next.getTime() - startOfDay(nowTs)) / (24 * 3600 * 1000));
  if (diffDays < 0) {
    next = new Date(y + 1, born.getMonth(), born.getDate(), 0, 0, 0);
    diffDays = Math.round((next.getTime() - startOfDay(nowTs)) / (24 * 3600 * 1000));
  }
  return { diff: diffDays, nextTs: next.getTime() };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ---------- 今日公历/农历/节气/节日 ---------- */
const WEEK_CN = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];

/* ---------- 节假日状态（数据来自 vendor/holidays.js，方便手动维护） ---------- */
// 数据由 window.HOLIDAY_DATA 提供（含当年 days 表）。
// type: 2 法定假日 / 3 调休补班（上班）/ 其余按周末(1)或工作日(0)判断。
// 键格式与 todayKey() 一致：YYYY-M-D（非补零）。

// 同步获取某天节假日信息（本地数据，永不「加载中」）
// 命中内置表 → 返回 type/name；否则按周末/工作日判断（type 1 / 0）
function getHolidayInfo(dateKey) {
  const days = (window.HOLIDAY_DATA && window.HOLIDAY_DATA.days) || {};
  const hit = days[dateKey];
  if (hit) return { type: hit.type, name: hit.name, date: dateKey, fromStatic: true };
  const [y, m, d] = dateKey.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return { type: (day === 0 || day === 6) ? 1 : 0, name: "", date: dateKey, fromStatic: true };
}

// 兼容旧调用：直接同步返回，必要时刷新小日历
function ensureTodayHoliday(dateKey) {
  renderMiniCalendar();
}

// 节假日状态 → 展示样式映射（type: 0 工作日 / 1 周末 / 2 节日 / 3 调休）
function holidayStatusMeta(info) {
  switch (info.type) {
    case 2: return { cls: "mc-holiday--festival", label: info.name ? `节日 · ${info.name}` : "节日" };
    case 3: return { cls: "mc-holiday--overtime", label: info.name ? `调休 · ${info.name.replace("调休","")}` : "调休上班" };
    case 1: return { cls: "mc-holiday--weekend",  label: "周末" };
    default: return { cls: "mc-holiday--workday",  label: "工作" };
  }
}

/* ---------- 独立小日历控件（今日信息 + 拖拽 + 位置持久化） ---------- */
const MC_POS_KEY = "mytime_mini_calendar_pos";

// 按天缓存 buildMiniCalendarEvents 结果，避免重复创建 Solar/Lunar 对象
const mcEventsCache = { dateKey: "", events: null };

// 生成今日及未来一段时间内的节日/节气事件列表
function buildMiniCalendarEvents(today) {
  const key = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  if (mcEventsCache.dateKey === key && mcEventsCache.events) return mcEventsCache.events;

  const events = [];
  const start = startOfDay(today);

  // 1) 当天事件（多条）
  const s0 = Solar.fromYmd(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const l0 = s0.getLunar();
  s0.getFestivals().forEach(f => events.push({ type: "festival", text: f, days: 0 }));
  s0.getOtherFestivals().forEach(f => events.push({ type: "festival", text: f, days: 0 }));
  l0.getFestivals().forEach(f => events.push({ type: "lunar", text: f, days: 0 }));
  const jq0 = l0.getJieQi();
  if (jq0) events.push({ type: "jieqi", text: jq0, days: 0 });

  // 2) 未来事件：节气（库 API） + 枚举未来 366 天节日
  const future = [];
  try {
    const jq = Lunar.fromSolar(Solar.fromDate(today)).getNextJieQi(true);
    if (jq && jq.getSolar()) {
      const js = jq.getSolar();
      const dt = new Date(js.getYear(), js.getMonth() - 1, js.getDay());
      const days = Math.round((dt - start) / 86400000);
      if (days > 0) future.push({ type: "jieqi", text: jq.getName(), days });
    }
  } catch (e) { /* 忽略 */ }

  for (let off = 1; off <= 366; off++) {
    const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off);
    const s = Solar.fromYmd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const l = s.getLunar();
    const names = [];
    s.getFestivals().forEach(f => names.push({ t: "festival", f }));
    s.getOtherFestivals().forEach(f => names.push({ t: "festival", f }));
    l.getFestivals().forEach(f => names.push({ t: "lunar", f }));
    names.forEach(({ t, f }) => future.push({ type: t, text: f, days: off }));
  }

  future.sort((a, b) => a.days - b.days);
  // 取最近的若干个未来事件补足（去重，最多补到总量约 5 条）
  const seen = new Set(events.map(e => e.type + "|" + e.text));
  for (const e of future) {
    const key = e.type + "|" + e.text;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(e);
    if (events.length >= 5) break;
  }
  mcEventsCache.dateKey = key;
  mcEventsCache.events = events;
  return events;
}

function renderMiniCalendar() {
  const box = document.getElementById("miniCalendar");
  if (!box) return;
  if (typeof Solar === "undefined" || typeof Lunar === "undefined") return;

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();

  const elDateLine = document.getElementById("mcDateLine");
  const elWeek = document.getElementById("mcWeek");
  const elXz = document.getElementById("mcXz");
  const elLunar = document.getElementById("mcLunar");
  const elAlmanac = document.getElementById("mcAlmanac");
  const elPengzu = document.getElementById("mcPengzu");
  const elMeta = document.getElementById("mcMeta");
  const elPosition = document.getElementById("mcPosition");
  const elJiXiong = document.getElementById("mcJiXiong");
  const elSha = document.getElementById("mcSha");
  const elEvents = document.getElementById("mcEvents");
  const elEventsList = document.getElementById("mcEventsList");
  const elHoliday = document.getElementById("mcHoliday");
  const elHandleTitle = document.getElementById("mcHandleTitle");
  if (!elDateLine || !elWeek || !elLunar || !elEvents) return;

  const week = WEEK_CN[now.getDay()];

  mcTitleDate = { m, d, week };

  if (elHandleTitle) {
    const collapsed = document.getElementById("mcBody") &&
      document.getElementById("mcBody").classList.contains("is-collapsed");
    elHandleTitle.textContent = collapsed ? `${m}月${d}日 ${week.replace("星期", "周")}` : "今日信息";
  }

  elDateLine.textContent = `${y}年${m}月${d}日`;
  elWeek.textContent = week;
  elWeek.className = "mc-pill mc-pill--week mc-pill--rainbow-" + now.getDay();
  elXz.textContent = `${solar.getXingZuo()}座`;
  elLunar.textContent = `${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年 · ${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;

  // 黄历：宜 / 忌（标签各占一行，详情按 5 列表格布局）
  if (elAlmanac) {
    const yi = (lunar.getDayYi() || []);
    const ji = (lunar.getDayJi() || []);
    const yiCells = yi.length
      ? yi.map(t => `<span class="mc-almanac__cell">${t}</span>`).join("")
      : `<span class="mc-almanac__cell">无</span>`;
    const jiCells = ji.length
      ? ji.map(t => `<span class="mc-almanac__cell">${t}</span>`).join("")
      : `<span class="mc-almanac__cell">无</span>`;
    elAlmanac.innerHTML =
      `<span class="mc-tag mc-tag--yi">宜</span>` +
      `<span class="mc-almanac__grid mc-detail-val--block">${yiCells}</span>` +
      `<span class="mc-tag mc-tag--ji">忌</span>` +
      `<span class="mc-almanac__grid mc-detail-val--block">${jiCells}</span>`;
  }

  // 彭祖百忌（每句独立一行）
  if (elPengzu) {
    const pgList = [lunar.getPengZuGan(), lunar.getPengZuZhi()].filter(Boolean);
    elPengzu.innerHTML =
      `<span class="mc-tag">彭祖百忌</span>` +
      `<span class="mc-detail-val mc-detail-val--block">` +
      pgList.map(t => `<span class="mc-pengzu__line">${t}</span>`).join("") +
      `</span>`;
  }

  // 干支 / 二十八宿 / 建星（标签独占一行，详情在下一行）
  if (elMeta) {
    const ganzhi = `${lunar.getYearInGanZhi()}·${lunar.getMonthInGanZhi()}·${lunar.getDayInGanZhi()}·${lunar.getTimeInGanZhi()}`;
    const xiu = lunar.getXiu ? lunar.getXiu() : "";
    const zhiXing = lunar.getZhiXing ? lunar.getZhiXing() : "";
    const tail = [xiu, zhiXing].filter(Boolean).join("·");
    elMeta.innerHTML =
      `<span class="mc-tag">干支</span>` +
      `<span class="mc-detail-val mc-detail-val--block"><b>${ganzhi}</b>${tail ? "　" + tail : ""}</span>`;
  }

  // 吉神宜趋 / 凶神宜忌（标签独占一行，详情按 5 列表格布局，各占一格）
  if (elJiXiong) {
    const jiShen = (lunar.getDayJiShen() || []);
    const xiongSha = (lunar.getDayXiongSha() || []);
    const jiCells = jiShen.length
      ? jiShen.map(t => `<span class="mc-almanac__cell">${t}</span>`).join("")
      : `<span class="mc-almanac__cell">无</span>`;
    const xiongCells = xiongSha.length
      ? xiongSha.map(t => `<span class="mc-almanac__cell">${t}</span>`).join("")
      : `<span class="mc-almanac__cell">无</span>`;
    elJiXiong.innerHTML =
      `<span class="mc-tag mc-tag--yi">吉神宜趋</span>` +
      `<span class="mc-almanac__grid mc-detail-val--block">${jiCells}</span>` +
      `<span class="mc-tag mc-tag--ji">凶神宜忌</span>` +
      `<span class="mc-almanac__grid mc-detail-val--block">${xiongCells}</span>`;
  }

  // 生肖冲煞（标签独占一行，详情下一行）
  if (elSha) {
    const chong = lunar.getDayChongDesc();
    const sha = lunar.getDaySha();
    const parts = [chong ? `冲${chong}` : "", sha ? `煞${sha}` : ""].filter(Boolean);
    elSha.innerHTML =
      `<span class="mc-tag">生肖冲煞</span>` +
      `<span class="mc-detail-val mc-detail-val--block">${parts.join("　") || "无"}</span>`;
  }

  // 吉神方位：喜神 / 财神 / 福神 / 阳贵 / 阴贵（3列表格布局，标签独占一行）
  if (elPosition) {
    const items = [
      ["喜神", lunar.getDayPositionXiDesc()],
      ["财神", lunar.getDayPositionCai && lunar.getDayPositionCai()],
      ["福神", lunar.getDayPositionFu && lunar.getDayPositionFu()],
      ["阳贵", lunar.getDayPositionYangGui && lunar.getDayPositionYangGui()],
      ["阴贵", lunar.getDayPositionYinGui && lunar.getDayPositionYinGui()],
    ].filter(it => it[1]);
    elPosition.innerHTML =
      `<span class="mc-tag">喜神方位</span>` +
      `<span class="mc-position__table mc-detail-val--block">` +
      items.map(([k, v]) => `<span class="mc-position__cell"><i>${k}</i>${v}</span>`).join("") +
      `</span>`;
  }

  const events = buildMiniCalendarEvents(now);
  const eventsRoot = elEventsList || elEvents;
  eventsRoot.innerHTML = "";
  if (events.length === 0) {
    const div = document.createElement("div");
    div.className = "mc-event mc-event--none";
    div.textContent = "未来一年无节日 / 节气";
    eventsRoot.appendChild(div);
  } else {
    events.forEach(e => {
      const div = document.createElement("div");
      div.className = "mc-event mc-event--" + e.type + (e.days === 0 ? " mc-event--today" : "");
      const icon = e.type === "jieqi" ? "🌿" : e.type === "lunar" ? "🌸" : "🎉";
      div.appendChild(document.createTextNode(`${icon} ${e.text}`));
      if (e.days !== 0) {
        div.appendChild(document.createTextNode(" | "));
        const tail = document.createElement("span");
        tail.className = "mc-event__tail";
        tail.textContent = `${e.days}天后`;
        div.appendChild(tail);
      }
      eventsRoot.appendChild(div);
    });
  }

  // 节假日状态徽标（本地数据，同步渲染，不会卡在「加载中」）
  if (elHoliday) {
    const dateKey = `${y}-${m}-${d}`;
    const info = getHolidayInfo(dateKey);
    const meta = holidayStatusMeta(info);
    elHoliday.className = "mc-holiday " + meta.cls;
    elHoliday.innerHTML = `<span class="mc-holiday__dot"></span>${meta.label}`;
  }
}

// 今日信息 展开折叠（状态持久化到本地）；农历详情 默认折叠、仅会话内切换，不持久化
const MC_ALL_KEY = "mytime_mc_all_collapsed";
const MC_LUNAR_KEY = "mytime_mc_lunar_collapsed";
let mcLunarOpen = false;
// 折叠态标题所需的日期信息（由 renderMiniCalendar 填充）
let mcTitleDate = { m: 0, d: 0, week: "" };

function applyMcCollapse() {
  // 默认：今日信息展开、农历详情折叠（无存储，刷新后回到折叠）
  const all = localStorage.getItem(MC_ALL_KEY) === "1";
  const lunar = !mcLunarOpen;
  const body = document.getElementById("mcBody");
  const allBtn = document.getElementById("mcToggleAll");
  const lunarBtn = document.getElementById("mcToggleLunar");
  const detail = document.getElementById("mcLunarDetail");
  const title = document.getElementById("mcHandleTitle");
  if (body) body.classList.toggle("is-collapsed", all);
  if (allBtn) allBtn.textContent = all ? "+" : "−";
  if (detail) detail.classList.toggle("is-collapsed", lunar);
  if (lunarBtn) lunarBtn.textContent = lunar ? "+" : "−";
  if (title) {
    title.textContent = all
      ? `${mcTitleDate.m}月${mcTitleDate.d}日 ${mcTitleDate.week.replace("星期", "周")}`
      : "今日信息";
  }
}

function initMcToggles() {
  const allBtn = document.getElementById("mcToggleAll");
  const lunarBtn = document.getElementById("mcToggleLunar");
  const onToggle = (btn, key) => {
    if (!btn) return;
    // 阻止冒泡，避免触发标题栏拖拽
    btn.addEventListener("mousedown", e => e.stopPropagation());
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const cur = localStorage.getItem(key) === "1";
      localStorage.setItem(key, cur ? "0" : "1");
      applyMcCollapse();
    });
  };
  // 今日信息：持久化展开/折叠
  onToggle(allBtn, MC_ALL_KEY);
  // 农历详情：仅会话内切换，不持久化（刷新后回到默认折叠）
  if (lunarBtn) {
    lunarBtn.addEventListener("mousedown", e => e.stopPropagation());
    lunarBtn.addEventListener("click", e => {
      e.stopPropagation();
      mcLunarOpen = !mcLunarOpen;
      applyMcCollapse();
    });
  }
  applyMcCollapse();
}

// 拖拽 + 位置持久化
function initMiniCalendarDrag() {
  const box = document.getElementById("miniCalendar");
  if (!box) return;
  const handle = box.querySelector(".mini-calendar__handle");
  if (!handle) return;

  // 恢复上次位置（默认左上角）
  try {
    const saved = JSON.parse(localStorage.getItem(MC_POS_KEY) || "null");
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      box.style.left = saved.x + "px";
      box.style.top = saved.y + "px";
      box.style.right = "auto";
      box.dataset.dragged = "1";
    }
  } catch (e) { /* 忽略 */ }

  let dragging = false;
  let startX = 0, startY = 0, originX = 0, originY = 0;

  const onDown = (e) => {
    dragging = true;
    box.classList.add("is-dragging");
    const rect = box.getBoundingClientRect();
    // 若尚未设置 left/top，则以当前位置为准
    if (getComputedStyle(box).left === "auto") {
      box.style.left = rect.left + "px";
      box.style.top = rect.top + "px";
      box.style.right = "auto";
    }
    originX = parseFloat(box.style.left) || 0;
    originY = parseFloat(box.style.top) || 0;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    let nx = originX + (pt.clientX - startX);
    let ny = originY + (pt.clientY - startY);
    // 限制在视口内
    const maxX = window.innerWidth - box.offsetWidth;
    const maxY = window.innerHeight - box.offsetHeight;
    nx = Math.max(0, Math.min(nx, maxX));
    ny = Math.max(0, Math.min(ny, maxY));
    box.style.left = nx + "px";
    box.style.top = ny + "px";
    if (e.cancelable) e.preventDefault();
  };

  const cleanupDrag = () => {
    if (!dragging) return;
    dragging = false;
    box.classList.remove("is-dragging");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
  };

  const onUp = () => {
    cleanupDrag();
    try {
      localStorage.setItem(MC_POS_KEY, JSON.stringify({
        x: parseFloat(box.style.left) || 0,
        y: parseFloat(box.style.top) || 0
      }));
    } catch (e) { /* 忽略 */ }
  };

  // 极端情况：标签页隐藏时强制清理拖拽态，防止事件监听器残留
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cleanupDrag();
  });

  handle.addEventListener("mousedown", onDown);
  handle.addEventListener("touchstart", onDown, { passive: false });
}

/* ---------- 事件绑定 ---------- */
els.addBtn.addEventListener("click", () => {
  requestNotifyPermission();
  openModal();
});
els.form.addEventListener("submit", submitTask);

els.typeSeg.querySelectorAll(".seg-item").forEach(b =>
  b.addEventListener("click", () => {
    formType = b.dataset.type;
    syncTypeUI();
  })
);
els.unitSeg.querySelectorAll(".seg-item").forEach(b =>
  b.addEventListener("click", () => {
    formUnit = b.dataset.unit;
    syncUnitUI();
  })
);

els.cronInput.addEventListener("input", refreshCronInfo);

/* 公历/农历切换 */
els.birthdayCalendarToggle.querySelectorAll(".seg-item").forEach(btn =>
  btn.addEventListener("click", () => {
    formCalendarTypeBirthday = btn.dataset.cal;
    syncCalendarTypeUI("birthday");
  })
);
els.memorialCalendarToggle.querySelectorAll(".seg-item").forEach(btn =>
  btn.addEventListener("click", () => {
    formCalendarTypeMemorial = btn.dataset.cal;
    syncCalendarTypeUI("memorial");
  })
);

/* 锚定模式切换（此刻 / 锚定） */
els.anchorSegCountdown.querySelectorAll(".seg-item").forEach(btn =>
  btn.addEventListener("click", () => {
    formAnchorModeCountdown = btn.dataset.anchor;
    syncAnchorUI();
  })
);
els.anchorSegCron.querySelectorAll(".seg-item").forEach(btn =>
  btn.addEventListener("click", () => {
    formAnchorModeCron = btn.dataset.anchor;
    syncAnchorUI();
  })
);

/* 农历选择器变化时更新基准日（用于年份计数） */
function refreshLunarRefDate(prefix) {
  const calendarType = prefix === "birthday" ? formCalendarTypeBirthday : formCalendarTypeMemorial;
  if (calendarType !== "lunar") return;
  const lunarYear = parseInt(els[prefix + "LunarYear"].value, 10) || new Date().getFullYear();
  const lunarMonth = parseInt(els[prefix + "LunarMonth"].value, 10) || 1;
  const lunarDay = parseInt(els[prefix + "LunarDay"].value, 10) || 1;
  const lunarLeap = els[prefix + "LunarLeap"].classList.contains("is-active");
  const sd = solarFromLunar(lunarYear, lunarMonth, lunarDay, lunarLeap);
  if (sd) {
    els[prefix + "Input"].value = ymdStr(sd);
  }
}

for (const prefix of ["birthday", "memorial"]) {
  els[prefix + "LunarYear"].addEventListener("change", () => { refreshLunarRefDate(prefix); refreshLunarDays(prefix); });
  els[prefix + "LunarMonth"].addEventListener("change", () => { refreshLunarRefDate(prefix); refreshLunarDays(prefix); });
  els[prefix + "LunarDay"].addEventListener("change", () => refreshLunarRefDate(prefix));
  els[prefix + "LunarLeap"].addEventListener("click", () => {
    els[prefix + "LunarLeap"].classList.toggle("is-active");
    refreshLunarRefDate(prefix);
    refreshLunarDays(prefix);
  });
}

els.modal.querySelectorAll("[data-close]").forEach(el =>
  el.addEventListener("click", closeModal)
);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !els.modal.hidden) closeModal();
  if (e.key === "Escape" && !els.dataModal.hidden) closeDataModal();
});

/* ---------- 数据管理事件绑定 ---------- */
els.dataBtn.addEventListener("click", openDataModal);
els.dataModal.querySelectorAll('[data-close="data"]').forEach(el =>
  el.addEventListener("click", closeDataModal)
);
els.exportBtn.addEventListener("click", exportData);
els.importPickBtn.addEventListener("click", () => els.importInput.click());
els.importInput.addEventListener("change", e => onImportFilePicked(e.target.files[0]));
els.importBtn.addEventListener("click", doImport);
els.fixeddayInput.addEventListener("input", onFixeddayInput);

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
// 初始化：优先读取本地保存，其次跟随系统偏好
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
})();

els.themeBtn.addEventListener("click", toggleTheme);

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

/* ---------- 启动 ---------- */
renderList();
renderDailyQuote();
renderMiniCalendar();
// 每天首次打开时获取当天节假日信息（缓存命中则不会发请求）
ensureTodayHoliday(todayKey());
initMiniCalendarDrag();
initMcToggles();
setInterval(updateTimers, 1000);

// 跨天自动刷新小日历信息：每分钟检查一次日期是否变化
let _dayInfoKey = new Date().toDateString();
setInterval(() => {
  const k = new Date().toDateString();
  if (k !== _dayInfoKey) {
    _dayInfoKey = k;
    renderMiniCalendar();
    ensureTodayHoliday(todayKey()); // 跨天后获取新一天的节假日状态
  }
}, 60 * 1000);

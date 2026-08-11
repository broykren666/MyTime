/* ===== MyTime 任务计时器 · 逻辑层 ===== */
"use strict";

const STORAGE_KEY = "mytime_tasks";
const UNIT_LABEL = { year: "年", month: "月", week: "周", day: "天", hour: "时", minute: "分" };
// 兼容旧数据：曾经用 "date" 表示固定日期，统一映射为 memorial（纪念）
const TYPE_ALIAS = { date: "memorial" };

/* 农历显示名称 */
const LUNAR_MONTH_NAMES = ['', '正月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','腊月'];
const LUNAR_DAY_NAMES = ['','初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
  '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
  '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];

/* 公历/农历切换状态（弹窗内，按类型的临时状态） */
let formCalendarTypeBirthday = "solar";
let formCalendarTypeMemorial = "solar";

function normalizeType(t) {
  return TYPE_ALIAS[t] || t;
}

/* ---------- 数据层 ---------- */
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(t => t && typeof t.id === "string")
      .map(t => {
        const task = { ...t, type: normalizeType(t.type) };
        // 迁移：固定日旧数据可能用逗号分隔，统一规范化为斜杠分隔
        if (task.type === "fixedday" && typeof task.fixeddayValue === "string") {
          const arr = parseFixeddays(task.fixeddayValue);
          task.fixeddayValue = arr.length ? arr.join("/") : "1";
        }
        // 迁移：倒计时任务缺少 createdAt 则补上当前时间，避免每次刷新重置倒计时
        if (task.type === "countdown" && !task.createdAt) {
          task.createdAt = Date.now();
        }
        return task;
      });
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
// 加载后若有旧数据被规范化（如固定日逗号→斜杠），写回存储保持一致
if (tasks.some(t => t.type === "fixedday")) saveTasks();
let editingId = null; // null = 添加模式
const notifiedIds = new Set(); // 已发送过结束通知的倒计时任务 id，避免每秒重复提醒
const cronCache = new Map(); // 缓存 Croner 实例，key 为 cron 表达式
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
  diSolar: document.getElementById("diSolar"),
  diLunar: document.getElementById("diLunar"),
  diTags: document.getElementById("diTags"),
  dailyQuote: document.getElementById("dailyQuote"),
  dqText: document.getElementById("dqText"),
  dqFrom: document.getElementById("dqFrom"),
};

/* 当前表单选择的类型 / 单位（临时状态） */
let formType = "countdown";
let formUnit = "year";

/* ---------- 工具 ---------- */
function todayStr() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function genId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function unitMs(unit) {
  switch (unit) {
    case "year": return 365 * 24 * 3600 * 1000;
    case "month": return 30 * 24 * 3600 * 1000;
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
    return refYear ? `农历${leap}${monthName}${dayName}（${refYear}年）` : `农历${leap}${monthName}${dayName}`;
  }
  return task.birthdayValue || "—";
}

function formatMemorialTime(task) {
  if (task.calendarType === "lunar") {
    const monthName = LUNAR_MONTH_NAMES[task.lunarMonth] || "";
    const dayName = LUNAR_DAY_NAMES[task.lunarDay] || "";
    const leap = task.lunarLeap ? "闰" : "";
    return `农历${leap}${monthName}${dayName}`;
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
  // 日期选项：1-30
  for (const sel of [els.birthdayLunarDay, els.memorialLunarDay]) {
    if (sel.options.length === 0) {
      for (let i = 1; i <= 30; i++) {
        sel.add(new Option(LUNAR_DAY_NAMES[i], i));
      }
    }
  }
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
  els.typeSeg.querySelectorAll(".seg-item").forEach(b => {
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
  els.unitSeg.querySelectorAll(".seg-item").forEach(b => (b.disabled = formType !== "countdown"));
  els.birthdayInput.disabled = formType !== "birthday";
  els.memorialInput.disabled = formType !== "memorial";
  els.fixeddayInput.disabled = formType !== "fixedday";
  els.cronInput.disabled = formType !== "cron";
  // 同步农历面板
  syncCalendarTypeUI("birthday");
  syncCalendarTypeUI("memorial");
}

function syncUnitUI() {
  els.unitSeg.querySelectorAll(".seg-item").forEach(b =>
    b.classList.toggle("is-active", b.dataset.unit === formUnit)
  );
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
    if (idx !== -1) tasks[idx] = { ...tasks[idx], ...base };
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

    // 兼容异常任务（progress 为 null）：回退纯文字显示，不渲染进度条
    if (progress === null || progress === undefined) {
      cell.className = "timer-cell" + (cls ? " " + cls : "");
      cell.textContent = text;
      return;
    }

    const bar = cell.querySelector(".gantt-bar");
    const fill = cell.querySelector(".gantt-fill");
    const label = cell.querySelector(".gantt-label");

    cell.className = "timer-cell has-gantt" + (cls ? " " + cls : "");
    // 甘特图填充色按剩余比例分段上色（绿/蓝/黄/橙/红）
    fill.className = "gantt-fill" + (cls ? " " + cls : "");
    fill.style.width = (progress * 100).toFixed(2) + "%";
    label.textContent = text;

    // 倒计时结束：发送一次浏览器通知
    if (task.type === "countdown" && cls === "is-done" && !notifiedIds.has(task.id)) {
      notifiedIds.add(task.id);
      notify(task.name, "倒计时已结束");
    }
    // Cron 触发：每个触发周期发送一次通知，重置时清除标记
    if (task.type === "cron") {
      if (text === "已触发" && !notifiedIds.has(task.id)) {
        notifiedIds.add(task.id);
        notify(task.name, "Cron 任务已触发");
      } else if (text !== "已触发") {
        notifiedIds.delete(task.id);
      }
    }
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
    const end = (task.createdAt || now) + task.cdValue * unitMs(task.cdUnit);
    const total = task.cdValue * unitMs(task.cdUnit) || 1;
    const remain = end - now;
    if (remain <= 0) return { text: "已结束", cls: "is-done", progress: 0, targetLabel: fmtDate(end) };

    // 进度 = 剩余占比（从左往右随时间递减）
    const progress = Math.max(0, Math.min(1, remain / total));
    return {
      text: fmtCountdown(remain),
      cls: progressLevelCls(progress),
      progress,
      targetLabel: fmtDate(end)
    };
  }

  if (task.type === "birthday") {
    // 农历纪念日
    if (task.calendarType === "lunar") {
      const nowDate = new Date(now);
      const nextTs = nextLunarOccurrence(task.lunarMonth, task.lunarDay, task.lunarLeap, now);
      if (!nextTs) return { text: "日期不合法", cls: "is-over", progress: null, targetLabel: "" };
      const diffDays = Math.round((nextTs - startOfDay(now)) / (24 * 3600 * 1000));
      const refYear = getReferenceYear(task);
      const yLabel = refYear ? `${nowDate.getFullYear() - refYear}年 | ` : "";
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
    const years = (now - born.getTime()) / unitMs("year");
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
    const remain = next.getTime() - now;
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
    return {
      text: fmtCountdown(remain),
      cls: progressLevelCls(progress),
      progress,
      targetLabel: "Cron"
    };
  }

  // 倒数日（固定目标日期，可过去可未来）
  if (task.type === "memorial") {
    let target = new Date((task.memorialValue || todayStr()) + "T00:00:00").getTime();
    // 农历倒数日：按当前/下一年转换
    if (task.calendarType === "lunar") {
      const nowDate = new Date(now);
      const thisYearSolar = solarFromLunar(nowDate.getFullYear(), task.lunarMonth, task.lunarDay, task.lunarLeap);
      if (thisYearSolar && thisYearSolar.getTime() >= startOfDay(now)) {
        target = thisYearSolar.getTime();
      } else {
        const nextYearSolar = solarFromLunar(nowDate.getFullYear() + 1, task.lunarMonth, task.lunarDay, task.lunarLeap);
        target = nextYearSolar ? nextYearSolar.getTime() : target;
      }
    }
    const diff = target - now;
    const days = Math.floor(Math.abs(diff) / (24 * 3600 * 1000));
    if (diff >= 0) {
      if (days === 0) return { text: "今天到期", cls: "is-red", progress: 0, targetLabel: fmtDate(target) };
      // 以「一年前到目标日」为一个周期估算进度
      const from = target - unitMs("year");
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

// 按剩余比例（progress，0~1）返回甘特图颜色分级：
// 100%-80% 绿 / 80%-60% 蓝 / 60%-40% 黄 / 40%-20% 橙 / 20%-0% 红
function progressLevelCls(progress) {
  const p = Math.max(0, Math.min(1, progress));
  if (p > 0.8) return "";          // 绿（基础色，无需额外类）
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

function renderDayInfo() {
  if (typeof Solar === "undefined" || typeof Lunar === "undefined") return;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // Solar.fromYmd 月份为 1-based
  const d = now.getDate();

  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();

  // 公历 + 星期
  const week = WEEK_CN[now.getDay()];
  const diSolar = els.diSolar;
  const diLunar = els.diLunar;
  if (diSolar) diSolar.innerHTML = `${y}年${m}月${d}日<span class="di-week">${week}</span>`;

  // 农历（getMonthInChinese 已自动处理闰月前缀"闰"）
  const lunarText = "农历 " + lunar.getMonthInChinese() + "月" + lunar.getDayInChinese();
  const animals = lunar.getYearShengXiao();
  const ganzhi = lunar.getYearInGanZhi();
  if (diLunar) diLunar.textContent = `${lunarText} · ${ganzhi}年（${animals}）`;

  // 节日 + 节气
  const tags = [];
  // 传统节日（如 春节、中秋、端午、除夕）
  solar.getFestivals().forEach(f => tags.push({ type: "festival", text: f }));
  // 现代/其他节日（如 元旦、劳动节、情人节、国庆节、母亲节等）
  solar.getOtherFestivals().forEach(f => tags.push({ type: "festival", text: f }));
  lunar.getFestivals().forEach(f => tags.push({ type: "festival", text: f }));
  // 24 节气（当天无节气时返回空串）
  const jq = lunar.getJieQi();
  if (jq) tags.push({ type: "jieqi", text: jq });

  const diTags = els.diTags;
  if (!diTags) return;

  // 当天有节日/节气 -> 直接展示
  if (tags.length > 0) {
    diTags.innerHTML = tags.map(t =>
      `<span class="di-tag t-${t.type}">${t.type === "jieqi" ? "🌿 " : "🎉 "}${t.text}</span>`
    ).join("");
    return;
  }

  // 当天无节日/节气 -> 查找下一个（节气用库 API，节日枚举未来 366 天）
  const next = findNextEvent(now);
  if (next) {
    const days = Math.round((next.date - startOfDay(now)) / 86400000);
    const label = days <= 0 ? "今天" : days + "天后";
    diTags.innerHTML = `<span class="di-tag t-${next.type}">${next.type === "jieqi" ? "🌿 " : "🎉 "}${next.text}（${label}）</span>`;
    return;
  }
  diTags.innerHTML = '<span class="di-tag t-none">未来一年无节日 / 节气</span>';
}

/* 查找从 today 起最近的一个节日或节气（含节日与 24 节气），返回 {type,text,date} */
function findNextEvent(today) {
  const candidates = [];
  // 1) 节气：使用 lunar.js 的 getNextJieQi（返回下一个节气）
  try {
    const jq = Lunar.fromSolar(Solar.fromDate(today)).getNextJieQi(true);
    if (jq && jq.getSolar()) {
      const js = jq.getSolar();
      candidates.push({ type: "jieqi", text: jq.getName(), date: new Date(js.getYear(), js.getMonth() - 1, js.getDay()) });
    }
  } catch (e) { /* 忽略 */ }

  // 2) 节日：枚举未来 366 天，收集公历/农历节日
  for (let off = 1; off <= 366; off++) {
    const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off);
    const s = Solar.fromYmd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const l = s.getLunar();
    const names = [];
    s.getFestivals().forEach(f => names.push(f));
    s.getOtherFestivals().forEach(f => names.push(f));
    l.getFestivals().forEach(f => names.push(f));
    names.forEach(f => candidates.push({ type: "festival", text: f, date: dt }));
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.date - b.date);
  return candidates[0];
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
  els[prefix + "LunarYear"].addEventListener("change", () => refreshLunarRefDate(prefix));
  els[prefix + "LunarMonth"].addEventListener("change", () => refreshLunarRefDate(prefix));
  els[prefix + "LunarDay"].addEventListener("change", () => refreshLunarRefDate(prefix));
  els[prefix + "LunarLeap"].addEventListener("click", () => {
    els[prefix + "LunarLeap"].classList.toggle("is-active");
    refreshLunarRefDate(prefix);
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
  const THROTTLE_MS = 60 * 1000; // 1 分钟内不重复请求 API，避免刷新限流

  // 读取本地缓存（含上次获取时间）
  let cached = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch (e) { cached = null; }

  // 命中缓存且未超过 1 分钟 -> 直接展示缓存，不请求 API
  if (cached && cached.text && Date.now() - (cached.ts || 0) < THROTTLE_MS) {
    setQuote(cached.text, cached.from);
    return;
  }

  // 真正优先 hitokoto：先清空（淡出），成功才显示 API 内容并写入缓存；
  // 仅 fetch 失败 / 限流 / 超时(2.5s)才回退内置兜底（兜底不写缓存，便于 1 分钟后重试 API）。
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
renderDayInfo();
renderDailyQuote();
setInterval(updateTimers, 1000);

// 跨天自动刷新顶部日期/农历信息：每分钟检查一次日期是否变化
let _dayInfoKey = new Date().toDateString();
setInterval(() => {
  const k = new Date().toDateString();
  if (k !== _dayInfoKey) {
    _dayInfoKey = k;
    renderDayInfo();
  }
}, 60 * 1000);

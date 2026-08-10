/* ===== MyTime 任务计时器 · 逻辑层 ===== */
"use strict";

const STORAGE_KEY = "mytime_tasks";
const UNIT_LABEL = { year: "年", month: "月", week: "周", day: "天", hour: "时", minute: "分" };
// 兼容旧数据：曾经用 "date" 表示固定日期，统一映射为 memorial（纪念）
const TYPE_ALIAS = { date: "memorial" };

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
  memorialField: document.getElementById("memorialField"),
  memorialInput: document.getElementById("memorialInput"),
  fixeddayField: document.getElementById("fixeddayField"),
  fixeddayInput: document.getElementById("fixeddayInput"),
  cronField: document.getElementById("cronField"),
  cronInput: document.getElementById("cronInput"),
  cronInfo: document.getElementById("cronInfo"),
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
  els.list.innerHTML = "";
  els.empty.hidden = tasks.length > 0;

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

    // 计时器（动态，data-id 便于每秒刷新）
    const tdTimer = document.createElement("td");
    tdTimer.className = "timer-cell";
    tdTimer.dataset.timer = task.id;

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
    els.list.appendChild(tr);
  });

  bindDragSort();
  updateTimers();
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
  if (task.type === "birthday") return task.birthdayValue || "—";
  if (task.type === "cron") return task.cronValue || "—";
  if (task.type === "fixedday") {
    return `每月 ${task.fixeddayValue || "1"} 日`;
  }
  return task.memorialValue || "—";
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
      els.birthdayInput.value = task.birthdayValue;
    } else if (task.type === "fixedday") {
      els.fixeddayInput.value = task.fixeddayValue;
    } else if (task.type === "cron") {
      els.cronInput.value = task.cronValue;
    } else {
      els.memorialInput.value = task.memorialValue;
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
  // 先显示弹窗再同步类型 UI，避免隐藏父级下 class 切换渲染失效
  syncTypeUI();
  syncUnitUI();
  refreshCronInfo();
}

function closeModal() {
  els.modal.hidden = true;
  editingId = null;
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
    base.birthdayValue = els.birthdayInput.value || todayStr();
  } else if (formType === "fixedday") {
    const arr = parseFixeddays(els.fixeddayInput.value);
    base.fixeddayValue = arr.length ? arr.join(",") : "1";
  } else if (formType === "cron") {
    const val = els.cronInput.value.trim();
    base.cronValue = val || "0 8 * * *";
  } else {
    base.memorialValue = els.memorialInput.value || todayStr();
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
    const cell = els.list.querySelector(`[data-timer="${task.id}"]`);
    if (!cell) return;
    const { text, cls } = computeTimer(task, now);
    cell.textContent = text;
    cell.className = "timer-cell" + (cls ? " " + cls : "");

    // 倒计时结束：发送一次浏览器通知
    if (task.type === "countdown" && cls === "is-done" && !notifiedIds.has(task.id)) {
      notifiedIds.add(task.id);
      notify(task.name, "倒计时已结束");
    }
  });
}

function computeTimer(task, now) {
  if (task.type === "countdown") {
    const end = (task.createdAt || now) + task.cdValue * unitMs(task.cdUnit);
    const remain = end - now;
    if (remain <= 0) return { text: "已结束", cls: "is-done" };

    const parts = [];
    let r = remain;
    const d = Math.floor(r / unitMs("day")); r -= d * unitMs("day");
    const h = Math.floor(r / unitMs("hour")); r -= h * unitMs("hour");
    const m = Math.floor(r / unitMs("minute")); r -= m * unitMs("minute");
    const s = Math.floor(r / 1000);

    if (d > 0) parts.push(`${d}天`);
    if (h > 0 || d > 0) parts.push(`${h}时`);
    if (m > 0 || h > 0 || d > 0) parts.push(`${m}分`);
    parts.push(`${s}秒`);

    return { text: "剩余 " + parts.join(" "), cls: "" };
  }

  if (task.type === "birthday") {
    const born = new Date((task.birthdayValue || todayStr()) + "T00:00:00");
    const years = (now - born.getTime()) / unitMs("year");
    const yLabel = years >= 1 ? `（${Math.floor(years)}年）` : "";
    const next = nextBirthday(born, now);
    if (next.diff === 0) return { text: `${yLabel}🎉纪念日快乐`, cls: "is-birthday" };
    return { text: `${yLabel}距纪念日 ${next.diff}天`, cls: levelCls(next.diff) };
  }

  if (task.type === "fixedday") {
    const days = parseFixeddays(task.fixeddayValue);
    if (days.length === 0) return { text: "未设置有效日期", cls: "" };
    let best = null;
    days.forEach(d => {
      const r = nextFixedDay(d, now);
      if (!best || r.diff < best.diff) best = { ...r, day: d };
    });
    if (best.diff === 0) return { text: `今天就是（${best.month}月${best.date}日）`, cls: "is-today" };
    return { text: `距（${best.month}月${best.date}日）还有 ${best.diff}天`, cls: levelCls(best.diff) };
  }

  if (task.type === "cron") {
    const expr = task.cronValue || "";
    if (!expr.trim()) return { text: "未设置表达式", cls: "" };
    let cronInst = cronCache.get(expr);
    if (!cronInst) {
      try {
        cronInst = new Cron(expr);
        cronCache.set(expr, cronInst);
      } catch (e) {
        return { text: "表达式无效", cls: "is-over" };
      }
    }
    const next = cronInst.nextRun();
    if (!next) return { text: "无匹配时间", cls: "is-over" };
    const remain = next.getTime() - now;
    if (remain <= 0) return { text: "已触发", cls: "is-today" };
    const parts = [];
    let r = remain;
    const d = Math.floor(r / unitMs("day")); r -= d * unitMs("day");
    const h = Math.floor(r / unitMs("hour")); r -= h * unitMs("hour");
    const m = Math.floor(r / unitMs("minute")); r -= m * unitMs("minute");
    const s = Math.floor(r / 1000);
    if (d > 0) parts.push(`${d}天`);
    if (h > 0 || d > 0) parts.push(`${h}时`);
    if (m > 0 || h > 0 || d > 0) parts.push(`${m}分`);
    parts.push(`${s}秒`);
    return { text: "剩余 " + parts.join(" "), cls: levelCls(d) };
  }

  // 倒数日（固定目标日期，可过去可未来）
  if (task.type === "memorial") {
  const target = new Date((task.memorialValue || todayStr()) + "T00:00:00").getTime();
  const diff = target - now;
  const days = Math.floor(Math.abs(diff) / (24 * 3600 * 1000));
  if (diff >= 0) {
    if (days === 0) return { text: "今天到期", cls: "is-today" };
    return { text: `距倒数日 ${days}天`, cls: levelCls(days) };
  }
  return { text: `已过期 ${days}天`, cls: "is-over" };
  }
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

// 按剩余天数返回颜色分级：>30 绿 / 10-30 橙 / <10 红；type 决定文案前缀由调用方处理
function levelCls(days) {
  if (days > 30) return "is-safe";
  if (days >= 10) return "is-warn";
  return "is-urgent";
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
  return { diff: diffDays };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
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

/* ---------- 启动 ---------- */
renderList();
setInterval(updateTimers, 1000);

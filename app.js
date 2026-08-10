/* ===== MyTime 任务计时器 · 逻辑层 ===== */
"use strict";

const STORAGE_KEY = "mytime_tasks";
const UNIT_LABEL = { year: "年", month: "月", week: "周", day: "天", hour: "时", minute: "分" };

/* ---------- 数据层 ---------- */
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(t => t && typeof t.id === "string");
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
let editingId = null; // null = 添加模式

/* ---------- DOM 引用 ---------- */
const els = {
  list: document.getElementById("taskList"),
  empty: document.getElementById("emptyState"),
  addBtn: document.getElementById("addBtn"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  form: document.getElementById("taskForm"),
  name: document.getElementById("nameInput"),
  desc: document.getElementById("descInput"),
  typeSeg: document.getElementById("typeSeg"),
  dateField: document.getElementById("dateField"),
  cdField: document.getElementById("countdownField"),
  dateInput: document.getElementById("dateInput"),
  cdValue: document.getElementById("cdValueInput"),
  unitSeg: document.getElementById("unitSeg"),
};

/* 当前表单选择的类型 / 单位（临时状态） */
let formType = "date";
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

    // 描述
    const tdDesc = document.createElement("td");
    tdDesc.className = "cell-desc";
    tdDesc.title = task.desc || "";
    tdDesc.textContent = task.desc || "—";

    // 操作
    const tdOps = document.createElement("td");
    tdOps.className = "col-ops";
    const ops = document.createElement("div");
    ops.className = "ops";

    const up = opBtn("↑", "上移", i === 0, () => move(i, -1));
    const down = opBtn("↓", "下移", i === tasks.length - 1, () => move(i, 1));
    const edit = opBtn("修改", "修改", false, () => openModal(task.id));
    const del = opBtn("删除", "删除", false, () => removeTask(task.id), true);

    ops.append(up, down, edit, del);
    tdOps.appendChild(ops);

    tr.append(tdIdx, tdName, tdTime, tdTimer, tdDesc, tdOps);
    els.list.appendChild(tr);
  });

  updateTimers();
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
  if (task.type === "date") return task.dateValue || "—";
  return `${task.cdValue} ${UNIT_LABEL[task.cdUnit] || ""}`;
}

/* ---------- 顺序调整 / 删除 ---------- */
function move(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= tasks.length) return;
  [tasks[index], tasks[target]] = [tasks[target], tasks[index]];
  saveTasks();
  renderList();
}

function removeTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (!confirm(`确定删除任务「${task.name}」吗？`)) return;
  tasks = tasks.filter(t => t.id !== id);
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
    els.desc.value = task.desc || "";
    if (task.type === "countdown") {
      formType = "countdown";
      formUnit = task.cdUnit;
      els.cdValue.value = task.cdValue;
    } else {
      formType = "date";
      els.dateInput.value = task.dateValue;
    }
  } else {
    els.modalTitle.textContent = "添加任务";
    formType = "date";
    formUnit = "year";
    els.dateInput.value = todayStr();
  }

  syncTypeUI();
  syncUnitUI();
  els.modal.hidden = false;
}

function closeModal() {
  els.modal.hidden = true;
  editingId = null;
}

function syncTypeUI() {
  els.typeSeg.querySelectorAll(".seg-item").forEach(b =>
    b.classList.toggle("is-active", b.dataset.type === formType)
  );
  els.dateField.hidden = formType !== "date";
  els.cdField.hidden = formType !== "countdown";
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
    desc: els.desc.value.trim(),
    type: formType,
  };

  let task;
  if (formType === "date") {
    base.dateValue = els.dateInput.value || todayStr();
  } else {
    const val = Math.max(1, parseInt(els.cdValue.value, 10) || 1);
    base.cdValue = val;
    base.cdUnit = formUnit;
    base.createdAt = Date.now();
  }

  if (editingId) {
    const idx = tasks.findIndex(t => t.id === editingId);
    if (idx !== -1) tasks[idx] = { ...tasks[idx], ...base };
  } else {
    tasks.push({ id: genId(), ...base });
  }

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
  });
}

function computeTimer(task, now) {
  if (task.type === "date") {
    const target = new Date((task.dateValue || todayStr()) + "T00:00:00").getTime();
    const diff = target - now;
    const days = Math.floor(Math.abs(diff) / (24 * 3600 * 1000));
    if (diff >= 0) {
      if (days === 0) return { text: "就是今天", cls: "" };
      return { text: `距今 ${days} 天`, cls: "" };
    }
    return { text: `已逾期 ${days} 天`, cls: "is-over" };
  }

  // 倒计时
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

/* ---------- 事件绑定 ---------- */
els.addBtn.addEventListener("click", () => openModal());
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

els.modal.querySelectorAll("[data-close]").forEach(el =>
  el.addEventListener("click", closeModal)
);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !els.modal.hidden) closeModal();
});

/* ---------- 启动 ---------- */
renderList();
setInterval(updateTimers, 1000);

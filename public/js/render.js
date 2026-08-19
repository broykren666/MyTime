/* ===== MyTime 任务计时器 · 列表渲染与排序 ===== */
"use strict";

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

    // 任务类型
    const tdType = document.createElement("td");
    tdType.className = "col-type";
    const icon = TYPE_ICON[task.type] || "•";
    const typeLabel = TYPE_LABEL[task.type] || task.type || "—";
    tdType.innerHTML = `<span class="type-icon">${icon}</span><span class="type-name">${typeLabel}</span>`;

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

    const dup = opBtn("复制", "复制为副本", false, () => duplicateTask(task.id));
    const edit = opBtn("修改", "修改", false, () => openModal(task.id));
    const del = opBtn("删除", "删除", false, () => removeTask(task.id), true);

    ops.append(dup, edit, del);
    tdOps.appendChild(ops);

    tr.append(tdDrag, tdIdx, tdType, tdName, tdTime, tdTimer, tdOps);
    frag.appendChild(tr);
  });

  els.list.replaceChildren(frag);
  bindDragSort();
  bindTouchSort();
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

/* ====================================================================
 * 移动端触摸手势（仅 ≤560px 生效，PC 端直接跳过，零影响）
 * - 长按卡片 ~380ms → 底部弹出操作栏（修改 / 删除）
 * - 长按后继续拖动 → 卡片排序，与「纵向滑动滚动」严格区分
 * ================================================================== */

// ---- 底部操作栏 ----
const actionSheet = document.getElementById("actionSheet");
const actionSheetOverlay = document.getElementById("actionSheetOverlay");
const actionSheetTitle = document.getElementById("actionSheetTitle");
const actionEditBtn = document.getElementById("actionEditBtn");
const actionDelBtn = document.getElementById("actionDelBtn");
const actionCancelBtn = document.getElementById("actionCancelBtn");
const actionDupBtn = document.getElementById("actionDupBtn");
let actionTargetId = null;

function showActionSheet(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  actionTargetId = taskId;
  actionSheetTitle.textContent = task.name;
  actionSheet.classList.add("is-open");
  actionSheetOverlay.classList.add("is-open");
  actionSheet.setAttribute("aria-hidden", "false");
}
function hideActionSheet() {
  actionTargetId = null;
  actionSheet.classList.remove("is-open");
  actionSheetOverlay.classList.remove("is-open");
  actionSheet.setAttribute("aria-hidden", "true");
}

let touchState = null; // 当前手势状态
const LONG_PRESS_MS = 380;       // 长按判定时长
const MOVE_CANCEL_PX = 10;       // 超时前移动超过此值 → 判定为滑动滚动
const DRAG_THRESHOLD_PX = 8;     // 长按后移动超过此值 → 进入拖动排序

function bindTouchSort() {
  if (!isMobileView()) return; // 桌面端跳过，保持原鼠标拖放逻辑

  const rows = els.list.querySelectorAll("tr");
  rows.forEach(row => {
    row.addEventListener("touchstart", onTouchStart, { passive: false });
    row.addEventListener("touchmove", onTouchMove, { passive: false });
    row.addEventListener("touchend", onTouchEnd, { passive: false });
    row.addEventListener("touchcancel", onTouchEnd, { passive: false });
  });
}

function onTouchStart(e) {
  if (!isMobileView() || touchState) return;
  const tr = e.currentTarget;
  const touch = e.touches[0];
  touchState = {
    tr,
    id: tr.dataset.id,
    startX: touch.clientX,
    startY: touch.clientY,
    grabOffsetY: 0,     // 手指距卡片顶的距离（进入拖动时记录，跟手用）
    curTranslate: 0,    // 当前累计跟手位移
    longFired: false,   // 已进入「长按待定」态（仅标记，不弹菜单）
    dragging: false,
    lastX: touch.clientX,
    lastY: touch.clientY,
    timer: null,
  };
  // 长按计时器：到点且手指基本未动 → 进入「长按待定」态（仅标记，不直接弹菜单）
  tr.classList.add("is-pressing"); // 按压反馈（JS 控制，关闭菜单后可可靠清除，避免原生高亮卡灰）
  touchState.timer = setTimeout(() => {
    if (!touchState) return;
    const dx = Math.abs(touchState.lastX - touchState.startX);
    const dy = Math.abs(touchState.lastY - touchState.startY);
    if (dx < MOVE_CANCEL_PX && dy < MOVE_CANCEL_PX) {
      touchState.longFired = true;
      if (navigator.vibrate) navigator.vibrate(15); // 震动反馈：已进入长按态
    }
  }, LONG_PRESS_MS);
}

function onTouchMove(e) {
  if (!touchState) return;
  const touch = e.touches[0];
  const dx = Math.abs(touch.clientX - touchState.startX);
  const dy = Math.abs(touch.clientY - touchState.startY);
  touchState.lastX = touch.clientX;
  touchState.lastY = touch.clientY;

  if (!touchState.longFired) {
    // 长按计时器到点前，若纵向位移过大 → 判定为滑动滚动，释放手势
    if (dy > MOVE_CANCEL_PX && dy > dx) {
      clearTimeout(touchState.timer);
      touchState.tr.classList.remove("is-pressing");
      touchState = null;
    }
    return; // 未进入长按态，不拦截，浏览器正常滚动
  }

  // 长按待定态：移动超过阈值 → 进入拖动排序（绝不弹菜单）
  if (!touchState.dragging && (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX)) {
    touchState.dragging = true;
    touchState.tr.classList.add("is-dragging-mobile");
    // 记录手指距卡片顶的偏移，使抓取点固定跟随手指
    touchState.grabOffsetY = touchState.startY - touchState.tr.getBoundingClientRect().top;
    touchState.curTranslate = 0;
  }
  if (touchState.dragging) {
    e.preventDefault(); // 阻止页面滚动，进入拖动排序
    // 先更新占位（DOM 插入位置）
    updateDragPosition(touchState.tr, touch.clientY);
    // 每帧把卡片视觉顶钉在「手指Y − 抓取偏移」，绝对跟手，不依赖占位基准
    const curVisualTop = touchState.tr.getBoundingClientRect().top;
    const targetTop = touch.clientY - touchState.grabOffsetY;
    touchState.curTranslate += (targetTop - curVisualTop);
    touchState.tr.style.transform = `translateY(${touchState.curTranslate}px)`;
  }
}

function onTouchEnd() {
  if (!touchState) return;
  clearTimeout(touchState.timer);
  const st = touchState;
  st.tr.classList.remove("is-pressing");
  touchState = null;
  if (st.dragging) {
    st.tr.classList.add("dropping");
    st.tr.style.transform = ""; // 平滑回弹到最终占位
    const tr = st.tr;
    // 回弹动画结束后提交，避免瞬间跳变
    setTimeout(() => {
      tr.classList.remove("is-dragging-mobile", "dropping");
      tr.style.transform = "";
      commitDrag(tr);
    }, 220);
  } else if (st.longFired) {
    // 长按待定态下松手且未拖动 → 视为长按点按，弹出操作菜单
    showActionSheet(st.id);
  }
}

// 根据手指 Y 与各卡片中线比较，实时调整插入位置（带 FLIP 平滑过渡）
function updateDragPosition(dragTr, y) {
  const others = Array.from(els.list.querySelectorAll("tr")).filter(r => r !== dragTr);
  // 计算目标插入点
  let target = null;
  for (const r of others) {
    const rect = r.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (y < mid) { target = r; break; }
  }
  // 仅当插入锚点真正跨过边界时才重排 + 播动画，避免高频 touchmove 打断过渡（防止"瞬间弹过去"）
  const changed = target
    ? dragTr.nextSibling !== target
    : els.list.lastElementChild !== dragTr;
  if (!changed) return;

  // FLIP - First：记录移动前其他行位置
  const firstTops = new Map();
  for (const r of others) firstTops.set(r, r.getBoundingClientRect().top);

  // 移动 DOM（仅在此刻）
  if (target) els.list.insertBefore(dragTr, target);
  else els.list.appendChild(dragTr);

  // FLIP - Invert/Play：让其他行从旧位平滑滑入新位
  for (const r of others) {
    const dy = firstTops.get(r) - r.getBoundingClientRect().top;
    if (!dy) continue;
    if (r.classList.contains("sort-anim")) continue; // 过渡进行中不打断，让其自然滑完
    r.classList.add("sort-anim");
    r.style.transition = "none";
    r.style.transform = `translateY(${dy}px)`;
    void r.offsetWidth; // 强制同步重排，确保反向位移立即生效
    r.style.transition = "";
    r.style.transform = "";
    // 动画结束后清理
    r.addEventListener("transitionend", function te(e) {
      if (e.propertyName !== "transform") return;
      r.removeEventListener("transitionend", te);
      r.classList.remove("sort-anim");
      r.style.transform = "";
    });
  }
}

// 提交排序：对比 DOM 顺序与 tasks 顺序，归并重排后持久化
function commitDrag(dragTr) {
  const order = Array.from(els.list.querySelectorAll("tr")).map(r => r.dataset.id);
  const map = new Map(tasks.map(t => [t.id, t]));
  const next = order.map(id => map.get(id)).filter(Boolean);
  if (next.length === tasks.length) {
    tasks = next;
    saveTasks();
    renderList();
  }
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
  if (task.type === "stopwatch") return formatStopwatchTime(task);
  if (task.type === "birthday") return formatBirthdayTime(task);
  if (task.type === "cron") return task.cronValue || "—";
  if (task.type === "fixedday") {
    return `每月 ${task.fixeddayValue || "1"} 日`;
  }
  return formatMemorialTime(task);
}

/* 格式化正计时的起点展示（设定值列） */
function formatStopwatchTime(task) {
  if (task.anchor) return fmtDate(task.anchor);
  return "此刻起";
}

/* 格式化纪念日/倒数日的日期展示 */
function formatBirthdayTime(task) {
  if (task.calendarType === "lunar") {
    const monthName = LUNAR_MONTH_NAMES[task.lunarMonth] || "";
    const dayName = LUNAR_DAY_NAMES[task.lunarDay] || "";
    const leap = task.lunarLeap ? "闰" : "";
    const refYear = getReferenceYear(task);
    return refYear ? `${leap}${monthName}${dayName} | ${refYear}年` : `${leap}${monthName}${dayName}`;
  }
  return task.birthdayValue || "—";
}

function formatMemorialTime(task) {
  if (task.calendarType === "lunar") {
    const monthName = LUNAR_MONTH_NAMES[task.lunarMonth] || "";
    const dayName = LUNAR_DAY_NAMES[task.lunarDay] || "";
    const leap = task.lunarLeap ? "闰" : "";
    const refYear = task.lunarYear || "";
    return refYear ? `${leap}${monthName}${dayName} | ${refYear}年` : `${leap}${monthName}${dayName}`;
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

/* ---------- 复制为副本（插入到原任务下方） ---------- */
function duplicateTask(id) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  const src = tasks[idx];
  if (!confirm(`确定复制任务「${src.name}」为副本吗？`)) return;
  const copy = { ...src, id: genId() };
  // 副本名称追加「(副本)」，避免触发同名限制
  copy.name = src.name.replace(/\s*\(副本\)$/, "") + " (副本)";
  if (copy.createdAt) copy.createdAt = Date.now();
  tasks.splice(idx + 1, 0, copy);
  saveTasks();
  renderList();
}

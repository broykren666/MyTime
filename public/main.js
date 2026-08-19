/* ===== MyTime 任务计时器 · 入口：事件绑定 + 启动 ===== */
"use strict";

/* ---------- 移动端操作栏事件 ---------- */
actionEditBtn.addEventListener("click", () => {
  const id = actionTargetId;
  hideActionSheet();
  if (id) openModal(id);
});
actionDelBtn.addEventListener("click", () => {
  const id = actionTargetId;
  hideActionSheet();
  if (id) removeTask(id);
});
actionDupBtn.addEventListener("click", () => {
  const id = actionTargetId;
  hideActionSheet();
  if (id) duplicateTask(id);
});
actionCancelBtn.addEventListener("click", hideActionSheet);
actionSheetOverlay.addEventListener("click", hideActionSheet);

/* ---------- 任务弹窗事件 ---------- */
els.addBtn.addEventListener("click", () => {
  requestNotifyPermission();
  openModal();
});
els.form.addEventListener("submit", submitTask);

/* ===== 八字计算弹窗事件 ===== */
// 公历/农历切换
baziCalTypeSeg.querySelectorAll(".seg-item").forEach(b =>
  b.addEventListener("click", () => baziSwitchCalType(b.dataset.cal))
);
// 关闭（遮罩 + 关闭按钮）
baziModal.querySelectorAll("[data-bazi-close]").forEach(el =>
  el.addEventListener("click", closeBaziCalculator)
);
// 计算
document.getElementById("baziCalcSubmit").addEventListener("click", calcBazi);
// 农历闰月按钮切换
baziLunarLeap.addEventListener("click", () => {
  baziLunarLeap.classList.toggle("is-active");
  baziRefreshLunarDays();
});
// 农历模式下切换年/月时刷新日选项
["baziLunarYear", "baziLunarMonth"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", baziRefreshLunarDays);
});
// Esc 关闭
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !baziModal.hidden) closeBaziCalculator();
});

/* ---------- 类型 / 单位切换 ---------- */
els.typeSeg.querySelectorAll(".seg-item").forEach(b =>
  b.addEventListener("click", () => {
    formType = b.dataset.type;
    syncTypeUI();
  })
);

// PC 端鼠标拖拽平移类型标签（标签过多时无需依赖滚动条）
(function enableTypeSegDragScroll() {
  const el = els.typeSeg;
  let down = false, startX = 0, startScroll = 0, moved = 0;
  el.addEventListener("mousedown", e => {
    down = true; moved = 0;
    startX = e.pageX; startScroll = el.scrollLeft;
  });
  el.addEventListener("mousemove", e => {
    if (!down) return;
    const dx = e.pageX - startX;
    moved = Math.max(moved, Math.abs(dx));
    el.scrollLeft = startScroll - dx;
  });
  const end = () => { down = false; };
  el.addEventListener("mouseup", end);
  el.addEventListener("mouseleave", end);
  // 拖拽距离超过阈值时，阻止误触发的标签 click
  el.addEventListener("click", e => {
    if (moved > 5) { e.preventDefault(); e.stopPropagation(); moved = 0; }
  }, true);
})();

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
    if (formAnchorModeCountdown === "now") fillNowAnchor("countdown");
    syncAnchorUI();
  })
);
els.anchorSegCron.querySelectorAll(".seg-item").forEach(btn =>
  btn.addEventListener("click", () => {
    formAnchorModeCron = btn.dataset.anchor;
    if (formAnchorModeCron === "now") fillNowAnchor("cron");
    syncAnchorUI();
  })
);
els.anchorSegStopwatch.querySelectorAll(".seg-item").forEach(btn =>
  btn.addEventListener("click", () => {
    formAnchorModeStopwatch = btn.dataset.anchor;
    if (formAnchorModeStopwatch === "now") fillNowAnchor("stopwatch");
    syncAnchorUI();
  })
);

/* 农历选择器变化时更新基准日（用于年份计数） */
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

/* ---------- 主题切换事件 ---------- */
els.themeBtn.addEventListener("click", toggleTheme);

/* ---------- 启动 ---------- */
initTheme();
initNotifyState();
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

// 八字时柱随系统时间（时辰）实时刷新：每分钟重渲染一次小日历
setInterval(renderMiniCalendar, 60 * 1000);

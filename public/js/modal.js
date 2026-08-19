/* ===== MyTime 任务计时器 · 添加/修改任务弹窗 ===== */
"use strict";

/* 当前表单选择的类型 / 单位 / 日历 / 锚定模式（临时状态） */
let formType = "countdown";
let formUnit = "year";
let formCalendarTypeBirthday = "solar";
let formCalendarTypeMemorial = "solar";
let formAnchorModeCountdown = "now";
let formAnchorModeCron = "now";
let formAnchorModeStopwatch = "now";

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
    } else if (task.type === "stopwatch") {
      formAnchorModeStopwatch = task.anchor ? "anchored" : "now";
      const ad = task.anchor ? new Date(task.anchor) : new Date();
      els.anchorDateStopwatch.value = todayStr(ad);
      els.anchorTimeStopwatch.value = ad.toTimeString().slice(0, 8);
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
    formAnchorModeStopwatch = "now";
    const now = new Date();
    const nowDate = todayStr(now);
    const nowTime = now.toTimeString().slice(0, 8);
    els.anchorDateCountdown.value = nowDate;
    els.anchorTimeCountdown.value = nowTime;
    els.anchorDateCron.value = nowDate;
    els.anchorTimeCron.value = nowTime;
    els.anchorDateStopwatch.value = nowDate;
    els.anchorTimeStopwatch.value = nowTime;
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
  // 年份默认选中当前年（否则默认 1900 年，其农历六月为小月29天，会缺失“三十”）
  const thisYear = String(new Date().getFullYear());
  for (const sel of [els.birthdayLunarYear, els.memorialLunarYear]) {
    if ([...sel.options].some(o => o.value === thisYear)) sel.value = thisYear;
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
  const base = startOfDay(nowTs);
  // 从当年起向后搜索（含当年当天），部分农历月无三十（小月）属正常，
  // 该年找不到则继续往后数年，直到命中第一个 ≥ 今天 的合法农历日。
  for (let k = 0; k <= 5; k++) {
    const solar = solarFromLunar(thisYear + k, lunarMonth, lunarDay, lunarLeap);
    if (solar && solar.getTime() >= base) {
      return solar.getTime();
    }
  }
  return null;
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

/* ---------- 表单类型/单位/锚定面板切换 ---------- */
function syncTypeUI() {
  const locked = editingId !== null; // 修改模式锁定任务类型
  segItems.typeItems.forEach(b => {
    b.classList.toggle("is-active", b.dataset.type === formType);
    b.disabled = locked;
  });
  // 根据任务类型动态显示对应输入区，隐藏其它（hidden 属性 + 淡入过渡）
  const fieldKey = { countdown: "cd", stopwatch: "stopwatch", birthday: "birthday", memorial: "memorial", fixedday: "fixedday", cron: "cron" };
  const show = type => {
    const el = els[fieldKey[type] + "Field"];
    el.hidden = formType !== type;
    el.classList.toggle("is-shown", formType === type);
  };
  show("countdown");
  show("stopwatch");
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
  els.anchorDateStopwatch.disabled = !(formType === "stopwatch" && formAnchorModeStopwatch === "anchored");
  els.anchorTimeStopwatch.disabled = !(formType === "stopwatch" && formAnchorModeStopwatch === "anchored");
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
  const segMap = { countdown: segItems.anchorCdnItems, cron: segItems.anchorCronItems, stopwatch: segItems.anchorStopwatchItems };
  const boxMap = { countdown: els.anchorDatetimeCountdown, cron: els.anchorDatetimeCron, stopwatch: els.anchorDatetimeStopwatch };
  const modeMap = { countdown: formAnchorModeCountdown, cron: formAnchorModeCron, stopwatch: formAnchorModeStopwatch };
  ["countdown", "cron", "stopwatch"].forEach(type => {
    const items = segMap[type];
    const mode = modeMap[type];
    items.forEach(b =>
      b.classList.toggle("is-active", b.dataset.anchor === mode)
    );
    const box = boxMap[type];
    const visible = formType === type && mode === "anchored";
    box.hidden = !visible;
    // 仅当前类型且锚定时启用日期框，避免隐藏必填校验问题
    let dateEl, timeEl;
    if (type === "countdown") { dateEl = els.anchorDateCountdown; timeEl = els.anchorTimeCountdown; }
    else if (type === "cron") { dateEl = els.anchorDateCron; timeEl = els.anchorTimeCron; }
    else { dateEl = els.anchorDateStopwatch; timeEl = els.anchorTimeStopwatch; }
    dateEl.disabled = !visible;
    timeEl.disabled = !visible;
  });
}

function submitTask(e) {
  e.preventDefault();
  const name = els.name.value.trim();
  if (!name) return;

  // 同名任务检测（忽略首尾空白与大小写）
  const dup = tasks.find(t =>
    t.id !== editingId && t.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (dup) {
    alert(`已存在同名任务「${dup.name}」，请修改名称后再提交`);
    els.name.focus();
    return;
  }

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
  } else if (formType === "stopwatch") {
    base.createdAt = Date.now();
    // 锚定模式（此刻=不写 anchor，沿用 createdAt；锚定=起始时刻）
    if (formAnchorModeStopwatch === "anchored") {
      const ts = anchorTimestamp(els.anchorDateStopwatch.value, els.anchorTimeStopwatch.value);
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

/* ---------- 固定日输入实时格式化 ---------- */
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

/* 将锚定起始时刻填充为「此刻」 */
function fillNowAnchor(type) {
  const now = new Date();
  let dateEl, timeEl;
  if (type === "countdown") { dateEl = els.anchorDateCountdown; timeEl = els.anchorTimeCountdown; }
  else if (type === "cron") { dateEl = els.anchorDateCron; timeEl = els.anchorTimeCron; }
  else { dateEl = els.anchorDateStopwatch; timeEl = els.anchorTimeStopwatch; }
  dateEl.value = todayStr(now);
  timeEl.value = now.toTimeString().slice(0, 8);
}

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

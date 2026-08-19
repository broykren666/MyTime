/* ===== MyTime 任务计时器 · 小日历/今日信息 ===== */
"use strict";

/* ---------- 今日公历/农历/节气/节日 ---------- */

/* 时辰（十二地支）：子时 23–1、丑时 1–3 … 亥时 21–23 */
const SHICHEN = ["子时","丑时","寅时","卯时","辰时","巳时","午时","未时","申时","酉时","戌时","亥时"];
function shichenOf(hour) {
  return SHICHEN[Math.floor((hour + 1) % 24 / 2)];
}

/* 时辰内的相对分钟（每时辰 2 小时，起点：子时=23、丑时=1、… 亥时=21） */
function shichenRelMin(hour, minute) {
  const idx = Math.floor((hour + 1) % 24 / 2);   // 0=子 … 11=亥
  const startHour = (idx * 2 + 23) % 24;          // 该时辰起始自然小时
  let rel = (hour - startHour) * 60 + minute;
  if (rel < 0) rel += 120;                         // 跨零点修正（子时 0–1 段）
  return rel;
}

/* 传统「X时N刻」：每时辰 8 刻，每刻 15 分钟，刻序从 1 起（通俗说法）。 */
const KE_CN = ["", "一", "二", "三", "四", "五", "六", "七", "八"];
function shichenKe(hour, minute) {
  const sc = shichenOf(hour);
  const ke = Math.floor(shichenRelMin(hour, minute) / 15) + 1; // 1..8
  return sc + KE_CN[ke] + "刻";
}

/* 填充「当前时间 + 时辰」行（年份日历日期行下方），精确到秒 */
function fillTimeLine() {
  const el = document.getElementById("mcTimeLine");
  if (!el) return;
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const hh = pad(now.getHours()), mm = pad(now.getMinutes()), ss = pad(now.getSeconds());
  el.textContent = `${hh}:${mm}:${ss} | ${shichenKe(now.getHours(), now.getMinutes())}`;
}

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
  fillTimeLine();
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

  // 八字（四柱）：基于系统当前完整时间（含时辰），随分钟刷新
  // 复用八字计算逻辑替代原「干支」行（二十八宿/建星作为后缀保留）
  if (elMeta) {
    const nowLunar = Solar.fromDate(now).getLunar();
    const ec = nowLunar.getEightChar();
    const bazi = `${ec.getYear()} ${ec.getMonth()} ${ec.getDay()} ${ec.getTime()}`;
    const xiu = nowLunar.getXiu ? nowLunar.getXiu() : "";
    const zhiXing = nowLunar.getZhiXing ? nowLunar.getZhiXing() : "";
    const tail = [xiu, zhiXing].filter(Boolean).join("·");
    elMeta.innerHTML =
      `<span class="mc-tag">八字</span>` +
      `<button id="baziCalcBtn" class="bazi-calc-btn" title="八字计算" aria-label="八字计算">🧮</button>` +
      `<span class="mc-detail-val mc-detail-val--block"><b>${bazi}</b>${tail ? "　" + tail : ""}</span>`;
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
  // head 中为避免刷新闪现而临时注入的折叠样式已完成使命，移除它，
  // 改由 applyMcCollapse 通过 is-collapsed class 控制显隐，
  // 否则点击展开时会被该样式（#mcBody{display:none}）覆盖而无法展开
  try {
    const tmp = document.getElementById("mc-collapse-restore");
    if (tmp) tmp.remove();
  } catch (e) {}

  applyMcCollapse();

  // 绑定八字计算图标点击事件（innerHTML 每次刷新都会重建按钮）
  const baziCalcBtn = document.getElementById("baziCalcBtn");
  if (baziCalcBtn) {
    baziCalcBtn.onclick = openBaziCalculator;
  }
}

// 拖拽 + 位置持久化
function initMiniCalendarDrag() {
  const box = document.getElementById("miniCalendar");
  if (!box) return;
  const handle = box.querySelector(".mini-calendar__handle");
  if (!handle) return;

  // 注：位置的「首帧恢复」已提前在 index.html 的 <head> 内联脚本中完成
  //      （避免刷新时在默认左上角闪一下）。这里把恢复出来的位置同步到内联
  //      style 上，保证后续拖拽以当前实际坐标为起点。
  try {
    const cs = getComputedStyle(box);
    const curLeft = parseFloat(cs.left);
    const curTop = parseFloat(cs.top);
    if (!isNaN(curLeft) && !isNaN(curTop) && cs.left !== "auto" && cs.top !== "auto") {
      box.style.left = curLeft + "px";
      box.style.top = curTop + "px";
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

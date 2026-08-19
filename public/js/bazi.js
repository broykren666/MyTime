/* ===== MyTime 任务计时器 · 八字计算弹窗 ===== */
"use strict";

const baziModal = document.getElementById("baziModal");
const baziCalTypeSeg = document.getElementById("baziCalTypeSeg");
const baziSolarRow = document.getElementById("baziSolarRow");
const baziSolarDate = document.getElementById("baziSolarDate");
const baziSolarTime = document.getElementById("baziSolarTime");
const baziLunarPicker = document.getElementById("baziLunarPicker");
const baziLunarTime = document.getElementById("baziLunarTime");
const baziLunarLeap = document.getElementById("baziLunarLeap");
let baziCalType = "solar"; // solar | lunar

/* 天干地支（用于给四柱附上完整干支显示，便于阅读） */
const BAZI_GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const BAZI_ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const BAZI_SHICHEN = ["子时", "丑时", "寅时", "卯时", "辰时", "巳时", "午时", "未时", "申时", "酉时", "戌时", "亥时"];

/* 初始化八字农历下拉（年/月/日），复用纪念日农历选择器逻辑 */
function baziInitLunarSelects() {
  const yearSel = document.getElementById("baziLunarYear");
  const monthSel = document.getElementById("baziLunarMonth");
  const daySel = document.getElementById("baziLunarDay");
  if (yearSel && yearSel.options.length === 0) {
    for (let y = 1900; y <= 2100; y++) yearSel.add(new Option(y + "年", y));
  }
  if (monthSel && monthSel.options.length === 0) {
    for (let i = 1; i <= 12; i++) monthSel.add(new Option(LUNAR_MONTH_NAMES[i], i));
  }
  if (daySel && daySel.options.length === 0) {
    for (let i = 1; i <= 30; i++) daySel.add(new Option(LUNAR_DAY_NAMES[i], i));
  }
  const thisYear = String(new Date().getFullYear());
  if (yearSel && [...yearSel.options].some(o => o.value === thisYear)) yearSel.value = thisYear;
  baziRefreshLunarDays();
}

/* 依据所选农历年/月/闰月重算日子范围，并裁剪日子下拉（仿 refreshLunarDays） */
function baziRefreshLunarDays() {
  const yearSel = document.getElementById("baziLunarYear");
  const monthSel = document.getElementById("baziLunarMonth");
  const daySel = document.getElementById("baziLunarDay");
  if (!yearSel || !monthSel || !daySel) return;
  const y = parseInt(yearSel.value, 10) || new Date().getFullYear();
  const m = parseInt(monthSel.value, 10) || 1;
  const leap = baziLunarLeap.classList.contains("is-active");

  let dayCount = 30;
  try {
    const ly = LunarYear.fromYear(y);
    if (leap && ly.getLeapMonth() === m) {
      const lm = ly.getMonths().find(mo => mo.getYear() === y && mo.getMonth() === m && mo.isLeap());
      dayCount = lm ? lm.getDayCount() : 30;
    } else {
      const lm = ly.getMonth(m);
      dayCount = lm ? lm.getDayCount() : 30;
    }
  } catch (e) { dayCount = 30; }

  const prevDay = parseInt(daySel.value, 10) || 1;
  daySel.options.length = 0;
  for (let i = 1; i <= dayCount; i++) daySel.add(new Option(LUNAR_DAY_NAMES[i], i));
  daySel.value = String(Math.min(prevDay, dayCount));
}

/* 切换公历/农历面板 */
function baziSwitchCalType(type) {
  baziCalType = type;
  baziCalTypeSeg.querySelectorAll(".seg-item").forEach(b => {
    b.classList.toggle("is-active", b.dataset.cal === type);
  });
  const isLunar = type === "lunar";
  baziSolarRow.hidden = isLunar;
  baziLunarPicker.hidden = !isLunar;
  document.getElementById("baziResult").hidden = true;
}

/* 打开弹窗 */
function openBaziCalculator() {
  baziSwitchCalType("solar");
  baziInitLunarSelects();

  // 默认填入当前公历日期时间
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const hh = now.getHours();
  const mi = now.getMinutes();
  baziSolarDate.value = `${y}-${pad2(m)}-${pad2(d)}`;
  baziSolarTime.value = `${pad2(hh)}:${pad2(mi)}`;
  baziLunarTime.value = `${pad2(hh)}:${pad2(mi)}`;

  // 同步：农历模式默认也定位到当前农历年月日，闰月关闭
  const curLunar = Solar.fromDate(now).getLunar();
  document.getElementById("baziLunarYear").value = String(curLunar.getYear());
  document.getElementById("baziLunarMonth").value = String(curLunar.getMonth());
  baziLunarLeap.classList.remove("is-active");
  baziRefreshLunarDays();
  document.getElementById("baziLunarDay").value = String(curLunar.getDay());

  // 打开弹窗时不展示八字结果，等待用户点击「开始计算八字」
  document.getElementById("baziResult").hidden = true;
  baziModal.hidden = false;
}

/* 关闭弹窗 */
function closeBaziCalculator() {
  baziModal.hidden = true;
}

/* 计算八字 */
function calcBazi() {
  let lunar, solar;
  try {
    if (baziCalType === "solar") {
      // 公历：从 date/time 输入控件取值
      const dateVal = baziSolarDate.value; // YYYY-MM-DD
      const timeVal = baziSolarTime.value || "00:00"; // HH:MM
      if (!dateVal) throw new Error("empty date");
      const [y, m, d] = dateVal.split("-").map(Number);
      const [h, mi] = timeVal.split(":").map(Number);
      solar = Solar.fromYmdHms(y, m, d, h, mi, 0);
      lunar = solar.getLunar();
    } else {
      const y = parseInt(document.getElementById("baziLunarYear").value, 10);
      const m = parseInt(document.getElementById("baziLunarMonth").value, 10);
      const d = parseInt(document.getElementById("baziLunarDay").value, 10);
      const lunarTimeVal = baziLunarTime.value || "00:00"; // HH:MM
      const [h, mi] = lunarTimeVal.split(":").map(Number);
      const leap = baziLunarLeap.classList.contains("is-active");

      // 农历月先转公历日期（带时分），再取 lunar，确保闰月/时辰都正确。
      // Lunar.fromYmdHms 不支持闰月参数，故统一走「农历→公历→lunar」路径。
      const solarDate = solarFromLunar(y, m, d, leap);
      if (!solarDate) throw new Error("invalid lunar date");
      solarDate.setHours(h, mi, 0, 0);
      solar = Solar.fromDate(solarDate);
      lunar = solar.getLunar();
    }
  } catch (e) {
    alert("日期无效，请检查输入。");
    return;
  }

  const ec = lunar.getEightChar();
  const yearGz = ec.getYear();
  const monthGz = ec.getMonth();
  const dayGz = ec.getDay();
  const timeGz = ec.getTime();

  // 直接展示四柱干支（不再拆分天干/地支）
  document.getElementById("baziResultYear").textContent = yearGz;
  document.getElementById("baziResultMonth").textContent = monthGz;
  document.getElementById("baziResultDay").textContent = dayGz;
  document.getElementById("baziResultHour").textContent = timeGz;

  const hourNum = shiChenIndex(timeGz);
  const shiChen = hourNum >= 0 ? BAZI_SHICHEN[hourNum] : timeGz;
  const shengXiao = lunar.getYearShengXiao();
  // 日期卡片：公历模式显示农历信息，农历模式显示公历信息（交叉展示）
  const isSolar = baziCalType === "solar";
  document.getElementById("baziMetaLabel").textContent = isSolar ? "农历" : "公历";
  document.getElementById("baziResultDate").textContent = isSolar
    ? `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`
    : `${solar.getYear()}年${solar.getMonth()}月${solar.getDay()}日`;
  document.getElementById("baziResultShiChen").textContent = shiChen;
  document.getElementById("baziResultZodiac").textContent = shengXiao;

  // ===== 生辰解析 =====
  const pillars = [
    { name: "年", gz: yearGz },
    { name: "月", gz: monthGz },
    { name: "日", gz: dayGz },
    { name: "时", gz: timeGz },
  ];
  const wuxingOf = [ec.getYearWuXing(), ec.getMonthWuXing(), ec.getDayWuXing(), ec.getTimeWuXing()];
  const nayinOf = [ec.getYearNaYin(), ec.getMonthNaYin(), ec.getDayNaYin(), ec.getTimeNaYin()];
  // 年/月/日/时 四字用胶囊包裹，4 列对齐显示
  const pillsHtml = vals =>
    pillars.map((p, i) => `<span class="bazi-ana-col"><span class="bazi-pill">${p.name}</span><span class="bazi-ana-val">${vals[i]}</span></span>`).join("");
  document.getElementById("baziAnaWuxing").innerHTML = pillsHtml(wuxingOf);
  document.getElementById("baziAnaNayin").innerHTML = pillsHtml(nayinOf);

  const dayGan = ec.getDayGan();
  const dayGanWx = ec.getDayWuXing();
  document.getElementById("baziAnaDayMaster").textContent = `${dayGan}（${dayGanWx}）`;

  // 五行统计：累计四柱五行中各元素个数，按数量从多到少排序
  const WX = ["木", "火", "土", "金", "水"];
  const wxChars = wuxingOf.join("");
  const counted = WX.map(w => ({ w, n: wxChars.split(w).length - 1 }))
                    .sort((a, b) => b.n - a.n);
  document.getElementById("baziAnaCount").innerHTML =
    counted.map(({ w, n }) => `<span class="bazi-wx-tag">${w}</span>${n}`).join("　");

  document.getElementById("baziResult").hidden = false;
}

/* 从时柱地支反推时辰序号（子时起始） */
function shiChenIndex(timeGz) {
  if (!timeGz || timeGz.length < 2) return -1;
  const zhi = timeGz[1];
  return BAZI_ZHI.indexOf(zhi);
}

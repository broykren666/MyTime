/* ===== MyTime 任务计时器 · 计时计算 ===== */
"use strict";

/* ---------- 计时器 ---------- */
function updateTimers() {
  fillTimeLine();
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
    if (remain <= 0) return { text: "已结束 | " + fmtCountdown(now - end), cls: "is-done", progress: 0, targetLabel: fmtDate(end) };

    // 进度 = 剩余占比（从左往右随时间递减）
    const progress = Math.max(0, Math.min(1, (end - now) / (end - start)));
    return {
      text: fmtCountdown(remain),
      cls: progressLevelCls(progress),
      progress,
      targetLabel: fmtDate(end) + (task.anchor ? " · 起 " + fmtDate(start) : "")
    };
  }

  if (task.type === "stopwatch") {
    const start = task.anchor || task.createdAt || now;
    const elapsedMs = now - start;
    const days = Math.floor(elapsedMs / 86400000);
    const text = start > now
      ? "未开始 | " + fmtCountdown(start - now)
      : (days > 0 ? "已 " + days + " 天 | " + fmtCountdown(elapsedMs) : fmtCountdown(elapsedMs));
    if (start > now) {
      // 未来起点：显示在甘特图中但进度条为空，仅展示「未开始 | 剩余时长」
      return { text, cls: "", progress: 0, targetLabel: fmtDate(start) };
    }
    // 进行中：显示在甘特图中但进度条为空，仅展示文本 xd xh xm xs
    return { text: fmtCountdown(elapsedMs), cls: "", progress: 0, targetLabel: "" };
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
        if (yearsPassed > 0) yLabel = `#${yearsPassed} | `;
      }
      if (diffDays === 0) {
        const leapLabel = task.lunarLeap ? "闰" : "";
        const todayLabel = `${yLabel}${leapLabel}${LUNAR_MONTH_NAMES[task.lunarMonth] || ""}${LUNAR_DAY_NAMES[task.lunarDay] || ""} | 今天`;
        return { text: todayLabel, cls: "is-red", progress: 0, targetLabel: fmtDate(nextTs) };
      }
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
    const yLabel = years >= 1 ? `#${Math.floor(years)} | ` : "";
    const next = nextBirthday(born, now);
    const nextTs = next.nextTs;
    if (next.diff === 0) {
      const d = new Date(nextTs);
      const todayLabel = `${yLabel}${d.getMonth() + 1}月${d.getDate()}日 | 今天`;
      return { text: todayLabel, cls: "is-red", progress: 0, targetLabel: fmtDate(nextTs) };
    }
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
    if (best.diff === 0) return { text: `${best.month}月${best.date}日 | 今天`, cls: "is-red", progress: 0, targetLabel: `${best.month}月${best.date}日` };
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
    // 注意：anchor 在存储中可能是毫秒时间戳，也可能是 ISO 字符串，
    // 需用 new Date() 归一化为数字时间戳，否则 now - 字符串 会得到 NaN，
    // 导致 Math.max(0, NaN) = 0，序号永远停在 1#。
    let prefix = "";
    if (task.anchor) {
      const anchorTs = new Date(task.anchor).getTime();
      if (!Number.isNaN(anchorTs)) {
        const n = Math.floor(Math.max(0, now - anchorTs) / period) + 1;
        prefix = `#${n} | `;
      }
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
    // 当天判断：target 与 now 是否为同一天（用日期而非毫秒差，避免目标在今日凌晨已过时误判为过期）
    const isSameDay = startOfDay(target) === startOfDay(now);
    if (isSameDay) {
      let todayLabel;
      if (task.calendarType === "lunar") {
        const leapLabel = task.lunarLeap ? "闰" : "";
        todayLabel = `${leapLabel}${LUNAR_MONTH_NAMES[task.lunarMonth] || ""}${LUNAR_DAY_NAMES[task.lunarDay] || ""} | 今天`;
      } else {
        const d = new Date(target);
        todayLabel = `${d.getMonth() + 1}月${d.getDate()}日 | 今天`;
      }
      return { text: todayLabel, cls: "is-red", progress: 0, targetLabel: fmtDate(target) };
    }
    if (diff >= 0) {
      // 以「一年前到目标日」为一个周期估算进度
      const from = target - unitMs("year", target);
      const progress = 1 - progressBetween(from, target, now);
      return { text: fmtCountdown(target - now), cls: progressLevelCls(progress), progress, targetLabel: fmtDate(target) };
    }
    return { text: `已过期 | ${days}天`, cls: "is-over", progress: 0, targetLabel: fmtDate(target) };
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

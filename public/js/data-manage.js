/* ===== MyTime 任务计时器 · 数据导入导出 ===== */
"use strict";

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

# MyTime 任务计时器

一个部署在 **Cloudflare Pages** 上的纯前端任务计时 Web 应用。所有数据保存在浏览器本地（localStorage），无需后端、无需登录，刷新不丢失，可离线使用。

## 功能特性

- **多种任务类型**
  - **倒计时**：从「此刻」或自定义「锚定」起始时刻起算，支持年/月/周/天/时/分。
  - **纪念日**：每年重复的生日、周年等，支持公历与农历（含闰月）。
  - **倒数日**：倒数的固定目标日期（可过去/未来），支持公历与农历。
  - **固定日**：每月指定日期重复，多个日子用 `/` 分隔，支持 `1`-`28`、`-1`/`-2`/`-3`（月末倒数）。
  - **Cron**：标准 5 段 Cron 表达式（`分 时 日 月 周`），实时显示下次触发时间与周期序号。
- **甘特图进度条**：计时以 10 档渐变色直观展示剩余进度（绿 → 红紫）。
- **今日信息小日历**：可拖动的悬浮控件，展示公历/农历、黄历（宜忌、彭祖百忌、冲煞、吉神方位）、节日节气、每日一言，折叠态与位置持久化。
- **八字计算**：内置弹窗，支持公历/农历输入，计算四柱八字、五行、纳音、日主与五行统计。
- **数据管理**：本地任务一键导出/导入 JSON（导入覆盖当前全部数据）。
- **浏览器通知**：倒计时结束、Cron 触发时发送一次本地通知（需授权）。

## 目录结构

```
MyTime/
├── public/                  # 静态站点构建输出目录（Pages 部署根）
│   ├── index.html           # 页面结构
│   ├── app.js               # 全部交互 / 计时 / 农历 / 八字逻辑
│   ├── styles.css           # 样式（含明/暗主题与甘特图）
│   └── vendor/              # 第三方库（本地内置，无需联网）
│       ├── croner.umd.min.js # Cron 解析（croner）
│       ├── lunar.js          # 农历/八字计算（lunar-javascript）
│       └── holidays.js        # 节假日静态数据（window.HOLIDAY_DATA）
├── x/                       # 开发笔记与记录（note.md 含域名等配置）
├── wrangler.toml            # Cloudflare Pages 配置
├── package.json
└── package-lock.json
```

## 部署

本项目通过 **Cloudflare Pages** 部署，构建输出目录为 `./public`（`wrangler.toml` 中 `pages_build_output_dir` 指定）。

发布方式：将 `public/` 内容部署到 Cloudflare Pages 即可（如使用 `wrangler pages deploy public`，或绑定 Git 仓库自动构建）。

## 本地预览

1. 进入 `public` 目录：

   ```bat
   cd public
   ```

2. 启动静态服务器（脚本已预置 `RunNodeJS-HTTP.bat`，监听 `0.0.0.0`）：

   ```bat
   http-server -c-1 -a 0.0.0.0
   ```

   浏览器访问 `http://localhost:8080`（默认端口）。

> 也可以直接双击 `public/index.html` 用浏览器打开，但部分浏览器对 `file://` 下的 fetch / 存储策略较严格，建议使用 http-server 预览。

## 使用说明

1. 点击右上角 **「+ 任务」** 添加任务，选择类型并填写参数。
2. 列表每行支持 **复制 / 修改 / 删除**（移动端长按卡片弹出操作栏）。
3. 拖拽行首手柄可调整任务顺序（PC 端鼠标拖拽，移动端长按后拖动）。
4. 点击 **「数据」** 可导出/导入全部任务 JSON。
5. 小日历控件可拖动到任意位置，点击标题栏的 `−`/`+` 折叠/展开，折叠态与位置自动保存。
6. 点击小日历中的 🧮 图标打开 **八字计算** 弹窗。

## 数据存储

- 任务数据存储在浏览器 `localStorage`（键名 `mytime_tasks`），**仅保存在本机浏览器**，不会上传服务器。
- 切换设备/清除浏览器数据会导致数据丢失，请善用「数据管理」中的导出功能备份。

## 技术栈

- 纯静态前端（HTML / CSS / 原生 JavaScript，无构建步骤、无框架）。
- 第三方库均内置在 `public/vendor/`，离线可用：
  - [croner](https://github.com/hexag0d/croner-js) — Cron 解析。
  - [lunar-javascript](https://github.com/6tail/lunar-javascript) — 农历、黄历、八字。
  - 节假日数据来自 `vendor/holidays.js`（可手动维护当年 `HOLIDAY_DATA`）。
- 「每日一言」默认调用 `https://v1.hitokoto.cn/`，失败时使用内置兜底语录，5 分钟内本地缓存。


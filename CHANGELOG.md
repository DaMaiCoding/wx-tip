# 更新日志 (Changelog)

## [1.1.0] - 2026-02-07

### 🚀 里程碑 (Milestone)
- **版本晋升**：基于文档重构与稳定性修复的里程碑版本。
- **文档同步**：所有技术文档已与代码实现完全对齐，消除过时信息。

### 📚 文档 (Documentation)
- 集成 v1.0.1 的所有文档更新。

## [1.0.1] - 2026-02-07

### 📚 文档更新 (Documentation)
- **核心文档重构**：全面更新 `README.md`，准确描述基于 UI Automation 的非侵入式防撤回原理。
- **部署指南修正**：更新 `DEPLOYMENT_GUIDE.md` 和 `TROUBLESHOOTING.md` 中的端口号（修正为 `19088`）及版本信息。
- **技术规范明确**：明确了项目依赖于 Windows UI Automation 技术，无需修改 WeChatWin.dll。
- **功能文档修正**：更新 `FEATURE_ANTI_RECALL.md` 中的日志文件路径描述。

### ⚡️ 优化 (Improvements)
- **端口标准化**：统一内部通讯端口为 `19088`，避免与常用开发端口冲突。
- **构建脚本优化**：优化 `build:win` 和 `build:portable` 脚本流程。

## [1.0.0] - 2026-02-01

### ✨ 新增功能 (New Features)
- **UI 重构**：全新设计的极简风格界面，移除冗余标题栏，采用 Windows 11 风格的卡片式布局。
- **系统通知增强**：
  - 接入 Windows 原生通知中心 (`AppUserModelId: wxTip`)。
  - 通知标题优化为 `💬 微信` 风格，去除冗余图标，提升视觉清爽度。
- **系统设置模块**：
  - 新增“开机自动启动”选项。
  - 新增“检查更新”功能（基于 `electron-updater`）。

### 🛠 修复与优化 (Fixes & Improvements)
- **消息监听逻辑重构 (`monitor.ps1`)**：
  - 修复了在多 List 控件（如联系人列表、会话列表并存）情况下无法准确定位消息列表的问题。
  - 新增智能定位策略：根据 UI 元素坐标（`BoundingRectangle`）优先锁定右侧消息区域。
  - 增加了详细的日志记录 (`monitor.log`) 用于排查捕获失败问题。
- **防撤回补丁升级**：
  - 移除了 Python 依赖，完全使用 Node.js 原生重写补丁逻辑。
  - 增加对 WeChat 4.0.x / 4.1.x 版本的特征码支持。
  - 增加了文件权限检查和进程占用检测，提升补丁成功率。

### ⚠️ 已知限制 (Known Limitations)
- 消息监听功能在微信**最小化到系统托盘**时会暂停工作（Windows UI Automation 机制限制）。
- 首次使用开机自启可能被杀毒软件拦截，需允许通过。

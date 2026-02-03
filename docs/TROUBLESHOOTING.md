# 打包应用监听问题诊断报告

## 问题概述

打包后的应用在生产环境中无法正常监听微信消息，而本地开发环境运行正常。

## 根本原因分析

### 1. 路径解析问题（最关键）

**问题描述：**
- 开发环境：`__dirname` = `src/main`，路径 `__dirname/services/monitor.ps1` 正确
- 打包后：`__dirname` 指向 `app.asar/src/main`，但 services 目录被复制到 `resources/services`

**影响：**
- 打包后无法找到 `monitor.ps1` 脚本
- PowerShell 监控进程无法启动
- 导致消息监听完全失效

**修复方案：**
```javascript
const scriptPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'services', 'monitor.ps1')
    : path.join(__dirname, 'services', 'monitor.ps1');
```

### 2. Express 服务器未就绪问题

**问题描述：**
- `startMonitor()` 可能在 Express 服务器 `listen()` 完成前被调用
- 导致 HTTP 请求失败，消息丢失

**修复方案：**
- 将 `startNotifyServer()` 改为 Promise 函数
- 在 `app.whenReady()` 中使用 `await` 确保服务器启动
- 添加 `notifyServerReady` 状态标志
- 在 `forwardToInternalServer()` 中检查服务器状态

### 3. 错误处理不足

**问题描述：**
- 缺少进程启动失败的错误处理
- 脚本文件不存在时没有明确提示
- 标准错误流输出未被捕获

**修复方案：**
- 添加 `fs.existsSync()` 检查
- 添加 `monitorProcess.on('error')` 事件处理
- 增强 `stderr` 输出日志
- 通过 IPC 向渲染进程发送错误状态

## 技术细节

### 环境差异对比

| 特性 | 开发环境 | 打包环境 |
|------|----------|----------|
| `__dirname` | `src/main` | `app.asar/src/main` |
| resourcesPath | 不适用 | `resources/` |
| services位置 | `src/main/services/` | `resources/services/` |
| 执行策略 | 继承系统 | 可能受限 |

### 端口绑定配置

```javascript
// Express 服务器绑定到 127.0.0.1:5000
notifyApp.listen(notifyPort, '127.0.0.1', callback);
```

- **本地地址绑定**：使用 `127.0.0.1` 而非 `localhost`，避免 DNS 解析
- **端口选择**：5000 端口，避免与其他服务冲突
- **防火墙要求**：不需要外部网络访问（仅内部通信）

## 修复后的代码变更

### 1. startMonitor 函数增强

- ✅ 动态路径解析（支持开发/打包环境）
- ✅ 脚本存在性检查
- ✅ 详细日志输出（路径、打包状态）
- ✅ 进程错误事件处理
- ✅ IPC 状态通知

### 2. startNotifyServer 函数增强

- ✅ Promise 封装，支持异步等待
- ✅ 服务器错误事件处理
- ✅ 就绪状态标志 `notifyServerReady`

### 3. forwardToInternalServer 函数增强

- ✅ 服务器就绪检查
- ✅ Content-Length 头设置
- ✅ 超时机制（1000ms）
- ✅ 完整错误处理

## 测试验证步骤

### 开发环境测试

```bash
# 启动开发服务器
npm start

# 验证日志输出
# 应该看到：
# [NotifyServer] Internal server running on port 5000
# [Monitor] Starting monitor from: ...\services\monitor.ps1
# [Monitor] Packaged: false
# [Monitor] Service started successfully
```

### 打包环境测试

#### 1. 安装版测试

```powershell
# 安装应用
.\dist\wxTip-1.0.0-setup.exe

# 启动应用并检查日志位置
# 日志路径：%APPDATA%\wxTip\logs\
# 查找关键日志：
# - [NotifyServer] Internal server running on port 5000
# - [Monitor] Starting monitor from: C:\Program Files\wxTip\resources\services\monitor.ps1
# - [Monitor] Packaged: true
# - [Monitor] Service started successfully
```

#### 2. 绿色版测试

```powershell
# 直接运行绿色版
.\dist\wxTip-1.0.0-portable.exe

# 检查临时目录日志
# 日志路径：临时目录\wxTip\logs\
# 验证同上
```

### 功能验证清单

- [ ] 应用启动后，Express 服务器成功启动（端口 5000）
- [ ] PowerShell 监控进程成功启动
- [ ] monitor.ps1 脚本路径正确（检查日志）
- [ ] 发送微信消息后能收到通知
- [ ] 渲染进程显示正确的状态
- [ ] 关闭应用后监控进程正常退出
- [ ] 重启应用后监控正常恢复

### 问题排查命令

```powershell
# 检查 PowerShell 进程
Get-Process powershell | Where-Object { $_.CommandLine -like "*monitor.ps1*" }

# 检查端口占用
netstat -ano | findstr :5000

# 检查日志文件
Get-Content $env:APPDATA\wxTip\logs\*.log -Tail 50

# 检查 resources 目录
Get-ChildItem "C:\Program Files\wxTip\resources\services"
```

## 预防措施

### 1. 开发规范

- 所有资源文件路径必须使用 `app.isPackaged` 检查
- 使用 `process.resourcesPath` 访问打包后的资源
- 添加文件存在性检查
- 提供详细的错误日志

### 2. 测试规范

- 每次打包后在干净环境测试
- 验证所有外部资源可访问性
- 检查进程启动和通信流程
- 验证日志输出完整性

### 3. 配置检查清单

打包前检查 `package.json`：
- [ ] `extraResources` 包含所有运行时资源
- [ ] `files` 包含所有源代码和资源
- [ ] `directories.buildResources` 正确配置
- [ ] 脚本执行策略参数完整

## 已知限制

1. **PowerShell 执行策略**：目标环境必须允许运行 PowerShell 脚本
2. **防火墙**：某些企业环境可能阻止进程间通信
3. **杀毒软件**：可能拦截 PowerShell 进程启动
4. **网络隔离**：需要微信客户端在同一系统运行

## 回归测试用例

### TC001: 基本监听功能
- 前置条件：应用已安装并启动
- 操作：发送微信消息
- 预期：收到桌面通知

### TC002: 服务自启动
- 前置条件：已启用开机自启动
- 操作：重启系统
- 预期：应用自动启动并开始监听

### TC003: 错误恢复
- 前置条件：监控正在运行
- 操作：手动终止 PowerShell 进程
- 预期：应用检测到退出并允许重新启动

### TC004: 资源完整性
- 前置条件：应用已安装
- 操作：检查 `resources/services/` 目录
- 预期：`monitor.ps1` 和 `config.json` 存在

### TC005: 日志记录
- 前置条件：应用运行
- 操作：检查日志文件
- 预期：包含启动、错误、状态变化的完整记录

## 技术支持

如遇问题，请提供：
1. 应用版本（`1.0.0`）
2. 操作系统版本
3. 日志文件（`%APPDATA%\wxTip\logs\`）
4. 复现步骤
5. 错误截图

---

生成日期：2026-02-03
适用版本：wxTip 1.0.0

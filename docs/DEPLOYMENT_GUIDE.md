# wxTip 部署验证指南
# wxTip 部署验证指南

本文档提供了在部署环境中验证微信消息监听功能的详细步骤。

## 快速验证步骤

### 1. 解压并运行绿色版

```powershell
# 1. 解压绿色版到测试目录
# wxTip-1.2.0-portable.exe 是自包含的，直接运行即可

# 2. 启动应用
.\wxTip-1.2.0-portable.exe

# 3. 检查进程是否启动
Get-Process wxTip -ErrorAction SilentlyContinue
```
```

### 2. 验证监控服务状态

启动应用后，在应用界面中：
1. 点击"开始监听"按钮
2. 观察控制台输出（开发模式）或日志文件（打包模式）

**期望的日志输出：**
```
[NotifyServer] Notify Server running on port 19088
[Monitor] Starting Monitor Service from: [路径]\resources\services\monitor.ps1
```

### 3. 测试消息通知

1. 使用另一台设备或微信号发送消息
2. 观察桌面是否弹出通知（或自定义弹窗）
3. 检查应用内的消息记录

## 详细诊断

### 手动检查关键文件

#### 检查 resources 目录结构

```powershell
# 对于安装版
$installPath = "C:\Program Files\wxTip"
# 对于绿色版，在解压目录下
Get-ChildItem "resources\services" -Recurse

# 期望输出：
# Directory: ...\resources\services
#
# Mode                 LastWriteTime         Length Name
# ----                 -------------         ------ ----
# -a----        [日期]  [时间]          [大小] monitor.ps1
```

#### 检查 PowerShell 执行策略

```powershell
Get-ExecutionPolicy -List
```

**注意**：应用使用 `-ExecutionPolicy Bypass` 参数启动脚本，因此系统执行策略通常不会影响运行。

### 检查进程状态

```powershell
# 查看应用进程
Get-Process wxTip | Format-List Name, Id, Path

# 查看关联的 PowerShell 进程
$wxTipPid = (Get-Process wxTip).Id
Get-Process powershell | Where-Object { $_.Parent.Id -eq $wxTipPid }
```

### 检查网络监听

```powershell
# 查看端口 19088 是否被监听
netstat -ano | findstr :19088

# 期望输出：
# TCP    127.0.0.1:19088        0.0.0.0:0              LISTENING       [PID]
```

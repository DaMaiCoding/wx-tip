# wxTip 部署验证指南

本文档提供了在部署环境中验证微信消息监听功能的详细步骤。

## 快速验证步骤

### 1. 解压并运行绿色版

```powershell
# 1. 解压绿色版到测试目录
# wxTip-1.0.0-portable.exe 是自包含的，直接运行即可

# 2. 启动应用
.\wxTip-1.0.0-portable.exe

# 3. 检查进程是否启动
Get-Process wxTip -ErrorAction SilentlyContinue
```

### 2. 验证监控服务状态

启动应用后，在应用界面中：
1. 点击"开始监听"按钮
2. 观察控制台输出（开发模式）或日志文件（打包模式）

**期望的日志输出：**
```
[NotifyServer] Internal server running on port 5000
[Monitor] Starting monitor from: [路径]\resources\services\monitor.ps1
[Monitor] Packaged: true
[Monitor] Spawning: powershell.exe -NoProfile -ExecutionPolicy Bypass -File [路径]
[Monitor] Service started successfully
```

### 3. 测试消息通知

1. 使用另一台设备或微信号发送消息
2. 观察桌面是否弹出通知
3. 检查应用内的消息记录

## 详细诊断

### 运行环境诊断脚本

```powershell
# 在应用目录下运行
node scripts/verify-monitor.js
```

### 手动检查关键文件

#### 检查 resources 目录结构

```powershell
# 对于安装版
$installPath = "C:\Program Files\wxTip"
Get-ChildItem "$installPath\resources\services" -Recurse

# 期望输出：
# Directory: ...\resources\services
#
# Mode                 LastWriteTime         Length Name
# ----                 -------------         ------ ----
# -a----        [日期]  [时间]          [大小] config.json
# -a----        [日期]  [时间]          [大小] monitor.ps1
```

#### 检查 PowerShell 执行策略

```powershell
Get-ExecutionPolicy -List
```

期望输出包含：
- MachinePolicy: (任意)
- UserPolicy: (任意)
- Process: Bypass 或 Unrestricted
- CurrentUser: Bypass 或 Unrestricted
- LocalMachine: (任意)

**注意**：应用使用 `-ExecutionPolicy Bypass` 参数启动脚本，因此系统执行策略不会影响运行。

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
# 查看端口 5000 是否被监听
netstat -ano | findstr :5000

# 期望输出：
# TCP    127.0.0.1:5000    0.0.0.0:0    LISTENING    [进程ID]
```

## 常见问题排查

### 问题 1: 监控服务无法启动

**症状**：日志显示 `Script not found`

**排查步骤**：
```powershell
# 1. 检查 resources 目录是否存在
Test-Path "$env:LOCALAPPDATA\Programs\wxTip\resources\services"

# 2. 检查脚本文件是否存在
Test-Path "$env:LOCALAPPDATA\Programs\wxTip\resources\services\monitor.ps1"

# 3. 查看 package.json 配置
# 确保 extraResources 包含 "src/main/services"
```

**解决方案**：重新安装应用，确保打包配置正确。

### 问题 2: PowerShell 执行被阻止

**症状**：日志显示权限错误

**排查步骤**：
```powershell
# 测试 PowerShell 执行
powershell.exe -ExecutionPolicy Bypass -File "path\to\monitor.ps1"
```

**解决方案**：
- 确保杀毒软件没有拦截
- 以管理员身份运行一次应用（创建例外规则）
- 检查企业安全策略

### 问题 3: 端口 5000 被占用

**症状**：日志显示 `EADDRINUSE` 或类似错误

**排查步骤**：
```powershell
# 查找占用端口的进程
netstat -ano | findstr :5000
# 记录最后一个数字（PID）
Get-Process -Id [PID]
```

**解决方案**：
- 关闭占用端口的程序
- 修改应用配置使用其他端口（需修改源码）

### 问题 4: 消息无法接收

**症状**：监控已启动，但收不到通知

**排查步骤**：
```powershell
# 1. 检查微信是否在运行
Get-Process Weixin, WeChat -ErrorAction SilentlyContinue

# 2. 检查微信窗口是否可见
# 监控服务只在微信窗口非活动状态下工作

# 3. 查看监控日志
# 位于 resources\services\monitor.log
```

**解决方案**：
- 确保微信客户端正在运行
- 确保微信窗口不是当前活动窗口
- 检查是否过滤了某些聊天（公众号、文件传输助手等）

## 性能监控

### 监控资源使用

```powershell
# 持续监控应用资源使用
while ($true) {
    $proc = Get-Process wxTip -ErrorAction SilentlyContinue
    if ($proc) {
        $cpu = [math]::Round($proc.CPU, 2)
        $mem = [math]::Round($proc.WorkingSet64 / 1MB, 2)
        Write-Host "CPU: $cpu% | Memory: $mem MB"
    }
    Start-Sleep -Seconds 5
}
```

### 监控日志文件大小

```powershell
# 检查日志文件
$logPath = "$env:APPDATA\wxTip\logs"
Get-ChildItem $logPath -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

## 自动化测试脚本

创建以下脚本进行批量测试：

```powershell
# test-deployment.ps1
$ErrorActionPreference = "Stop"

Write-Host "Starting wxTip deployment test..." -ForegroundColor Cyan

# Test 1: Application starts
Write-Host "`n[Test 1] Starting application..." -ForegroundColor Yellow
$proc = Start-Process -FilePath ".\wxTip-1.0.0-portable.exe" -PassThru
Start-Sleep -Seconds 5

if ($proc.HasExited) {
    Write-Host "FAILED: Application exited prematurely" -ForegroundColor Red
    exit 1
} else {
    Write-Host "PASSED: Application is running (PID: $($proc.Id))" -ForegroundColor Green
}

# Test 2: Port is listening
Write-Host "`n[Test 2] Checking port 5000..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$port = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue

if ($port) {
    Write-Host "PASSED: Port 5000 is listening" -ForegroundColor Green
} else {
    Write-Host "FAILED: Port 5000 is not listening" -ForegroundColor Red
    Stop-Process -Id $proc.Id -Force
    exit 1
}

# Test 3: PowerShell monitor is running
Write-Host "`n[Test 3] Checking PowerShell monitor..." -ForegroundColor Yellow
$monitor = Get-Process powershell | Where-Object { $_.Parent.Id -eq $proc.Id }

if ($monitor) {
    Write-Host "PASSED: Monitor process is running (PID: $($monitor.Id))" -ForegroundColor Green
} else {
    Write-Host "WARNING: Monitor process not detected (may be normal if not started via UI)" -ForegroundColor Yellow
}

# Test 4: Clean shutdown
Write-Host "`n[Test 4] Testing clean shutdown..." -ForegroundColor Yellow
Stop-Process -Id $proc.Id -Force
Start-Sleep -Seconds 2

$stillRunning = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($stillRunning) {
    Write-Host "FAILED: Application did not shut down cleanly" -ForegroundColor Red
    Stop-Process -Id $proc.Id -Force
    exit 1
} else {
    Write-Host "PASSED: Application shut down cleanly" -ForegroundColor Green
}

Write-Host "`n✅ All tests passed!" -ForegroundColor Green
```

运行测试：
```powershell
.\test-deployment.ps1
```

## 日志收集

当报告问题时，请收集以下信息：

```powershell
# 创建日志收集包
$packageDir = "wxTip-logs-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $packageDir | Out-Null

# 复制应用日志
Copy-Item "$env:APPDATA\wxTip\logs\*" -Destination $packageDir -Recurse -ErrorAction SilentlyContinue

# 导出系统信息
Get-ComputerInfo | Out-File "$packageDir\system-info.txt"

# 导出进程信息
Get-Process | Format-List Name, Id, Path, Company | Out-File "$packageDir\processes.txt"

# 导出网络状态
Get-NetTCPConnection | Out-File "$packageDir\network-connections.txt"

# 创建压缩包
Compress-Archive -Path $packageDir -DestinationPath "$packageDir.zip"
Remove-Item -Path $packageDir -Recurse

Write-Host "Log package created: $packageDir.zip"
```

## 回归测试清单

每次发布新版本前，请执行以下测试：

- [ ] 安装版可以正常安装
- [ ] 绿色版可以直接运行
- [ ] 监控服务可以成功启动
- [ ] 桌面通知正常显示
- [ ] 消息内容正确解析
- [ ] 应用可以正常关闭
- [ ] 重新启动后设置保留
- [ ] CPU 和内存占用正常（< 100MB）
- [ ] 日志文件正常生成
- [ ] 没有控制台错误输出

---

文档版本: 1.0.0
最后更新: 2026-02-03

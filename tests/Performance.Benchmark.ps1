function Parse-WeChatMessage {
    param([string]$fullTxt)
    
    if ([string]::IsNullOrEmpty($fullTxt)) {
        return @{ chatName = ""; messageContent = "" }
    }
    
    $lines = $fullTxt -split "`n" | Where-Object { $_.Trim() -ne "" }
    
    if ($lines.Count -eq 0) {
        return @{ chatName = ""; messageContent = "" }
    }
    
    $chatName = $lines[0]
    $messageContent = ""
    
    $skipPatterns = @(
        "^\[\d+条?\]$",
        "^\d{1,2}:\d{2}$",
        "^\d{1,2}:\d{2}:\d{2}$",
        "^(Yesterday|Today)\s+\d{1,2}:\d{2}$",
        "^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}:\d{2}$",
        "^\d{4}-\d{2}-\d{2}$",
        "^AM|PM\s+\d{1,2}:\d{2}$",
        "^\[Image\]$",
        "^\[Video\]$",
        "^\[Voice\]$",
        "^\[File\]$",
        "^\[Link\]$",
        "^\[Emoji\]$",
        "^\[Location\]$",
        "^\[ChatHistory\]$",
        "DoNotDisturb",
        "^WeChatVoice\s*$",
        "^VoiceCall\s*\d{1,3}sec$",
        "^VideoCall\s*\d{1,3}sec$"
    )
    
    $foundContent = $false
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $line = $lines[$i].Trim()
        
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        
        $shouldSkip = $false
        foreach ($pattern in $skipPatterns) {
            if ($line -match $pattern) {
                $shouldSkip = $true
                break
            }
        }
        
        if (-not $shouldSkip) {
            $messageContent = $line
            $foundContent = $true
            break
        }
    }
    
    if (-not $foundContent) {
        $messageContent = $chatName
    }
    
    return @{
        chatName = $chatName
        messageContent = $messageContent
    }
}

function Get-PerformanceMetrics {
    $process = Get-Process -Id $PID
    $cpuBefore = $process.CPU
    $memoryBefore = $process.WorkingSet64
    
    return @{
        process = $process
        cpuBefore = $cpuBefore
        memoryBefore = $memoryBefore
    }
}

function Measure-PerformanceDelta {
    param($metrics)
    
    $process = Get-Process -Id $PID
    $cpuAfter = $process.CPU
    $memoryAfter = $process.WorkingSet64
    
    $cpuTime = $cpuAfter - $metrics.cpuBefore
    $memoryDelta = $memoryAfter - $metrics.memoryBefore
    $memoryDeltaMB = [math]::Round($memoryDelta / 1MB, 2)
    
    return @{
        cpuTime = $cpuTime
        memoryDelta = $memoryDeltaMB
    }
}

function New-TestMessage {
    param([int]$index)
    
    $messageTypes = @(
        "python-group`nmessage $index content here`n11:40",
        "tech-group`n[5]`ntomorrow meeting $index`nreceived`n14:30",
        "work-group`n[Image]`n[10]`nscreenshot sent $index`n16:45",
        "family-group`nVoiceCall 30sec`ncalled you $index`n10:15",
        "project-group`nMon 09:30`nAre you done task $index`nToday 15:00"
    )
    
    return $messageTypes[$index % $messageTypes.Count]
}

Write-Host ""
Write-Host "========== Message Parser Performance Benchmark ==========" -ForegroundColor Cyan
Write-Host ""

$iterations = 10000
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Iterations: $iterations messages" -ForegroundColor White
Write-Host "  Target Input Rate: ~10MB/s" -ForegroundColor White
Write-Host "  Target CPU: <30%" -ForegroundColor White
Write-Host "  Target Memory: <20% increase" -ForegroundColor White
Write-Host ""

$metrics = Get-PerformanceMetrics

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

$testMessages = @()
for ($i = 0; $i -lt $iterations; $i++) {
    $testMessages += (New-TestMessage -index $i)
}

$prepTime = $stopwatch.ElapsedMilliseconds
Write-Host "Test data preparation: ${prepTime}ms" -ForegroundColor Gray

$stopwatch.Restart()

foreach ($msg in $testMessages) {
    $result = Parse-WeChatMessage -fullTxt $msg
}

$elapsed = $stopwatch.ElapsedMilliseconds
$delta = Measure-PerformanceDelta -metrics $metrics

$avgTimePerMsg = [math]::Round($elapsed / $iterations * 1000, 2)
$msgPerSec = [math]::Round($iterations / ($elapsed / 1000), 2)
$avgMsgSize = 150
$dataThroughput = [math]::Round(($iterations * $avgMsgSize) / ($elapsed / 1000) / 1MB, 2)
$cpuUsage = [math]::Round(($delta.cpuTime.TotalMilliseconds / $elapsed) * 100, 2)

Write-Host ""
Write-Host "========== Benchmark Results ==========" -ForegroundColor Cyan
Write-Host ""
Write-Host "Execution Time:" -ForegroundColor Yellow
Write-Host "  Total: ${elapsed}ms ($($iterations) messages)" -ForegroundColor White
Write-Host "  Average per message: ${avgTimePerMsg}μs" -ForegroundColor White
Write-Host ""
Write-Host "Throughput:" -ForegroundColor Yellow
Write-Host "  Messages per second: $msgPerSec msg/s" -ForegroundColor White
Write-Host "  Data throughput: ${dataThroughput}MB/s" -ForegroundColor White
Write-Host ""
Write-Host "Resource Usage:" -ForegroundColor Yellow
Write-Host "  CPU time: $($delta.cpuTime.TotalMilliseconds)ms" -ForegroundColor White
Write-Host "  Estimated CPU usage: ${cpuUsage}%" -ForegroundColor $(if ($cpuUsage -lt 30) { "Green" } else { "Red" })
Write-Host "  Memory delta: $($delta.memoryDelta)MB" -ForegroundColor $(if ($delta.memoryDelta -lt 20) { "Green" } else { "Red" })
Write-Host ""

$allPassed = $true

if ($cpuUsage -ge 30) {
    Write-Host "[FAIL] CPU usage $cpuUsage% exceeds target of 30%" -ForegroundColor Red
    $allPassed = $false
} else {
    Write-Host "[PASS] CPU usage $cpuUsage% within target of 30%" -ForegroundColor Green
}

if ($delta.memoryDelta -ge 20) {
    Write-Host "[FAIL] Memory delta $($delta.memoryDelta)MB exceeds target of 20MB" -ForegroundColor Red
    $allPassed = $false
} else {
    Write-Host "[PASS] Memory delta $($delta.memoryDelta)MB within target of 20MB" -ForegroundColor Green
}

if ($msgPerSec -lt 100) {
    Write-Host "[FAIL] Throughput $msgPerSec msg/s below minimum of 100 msg/s" -ForegroundColor Red
    $allPassed = $false
} else {
    Write-Host "[PASS] Throughput $msgPerSec msg/s exceeds minimum of 100 msg/s" -ForegroundColor Green
}

Write-Host ""
Write-Host "Performance Grade: " -NoNewline -ForegroundColor Cyan
if ($cpuUsage -lt 15 -and $delta.memoryDelta -lt 10 -and $msgPerSec -gt 500) {
    Write-Host "EXCELLENT" -ForegroundColor Green
} elseif ($cpuUsage -lt 30 -and $delta.memoryDelta -lt 20 -and $msgPerSec -gt 100) {
    Write-Host "GOOD" -ForegroundColor Yellow
} else {
    Write-Host "NEEDS IMPROVEMENT" -ForegroundColor Red
}
Write-Host ""

if ($allPassed) {
    Write-Host "All performance targets met!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some performance targets not met" -ForegroundColor Yellow
    exit 1
}

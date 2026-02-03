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

function Test-ParseWeChatMessage {
    param(
        [string]$name,
        [string]$testInput,
        [string]$expectedChatName,
        [string]$expectedContent
    )
    
    $result = Parse-WeChatMessage -fullTxt $testInput
    
    $passed = $true
    $errors = @()
    
    if ($result.chatName -ne $expectedChatName) {
        $passed = $false
        $errors += "chatName mismatch: expected='$expectedChatName', got='$($result.chatName)'"
    }
    
    if ($result.messageContent -ne $expectedContent) {
        $passed = $false
        $errors += "messageContent mismatch: expected='$expectedContent', got='$($result.messageContent)'"
    }
    
    if ($passed) {
        Write-Host "[PASS] $name" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $name" -ForegroundColor Red
        foreach ($error in $errors) {
            Write-Host "  $error" -ForegroundColor Red
        }
    }
    
    return $passed
}

Write-Host ""
Write-Host "========== WeChat Message Parser Tests ==========" -ForegroundColor Cyan
Write-Host ""

$totalTests = 0
$passedTests = 0

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test1: Basic text message" -testInput "python-group`nmessage content`n11:40" -expectedChatName "python-group" -expectedContent "message content"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test2: Single line message" -testInput "python-group`nhello" -expectedChatName "python-group" -expectedContent "hello"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test3: With badge count" -testInput "group-warning`n[3]`nmessage`n11:37" -expectedChatName "group-warning" -expectedContent "message"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test4: Multi-line" -testInput "tech-group`n[5]`ntomorrow meeting`nreceived`n14:30" -expectedChatName "tech-group" -expectedContent "tomorrow meeting"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test5: Empty input" -testInput "" -expectedChatName "" -expectedContent ""

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test6: Only system marks" -testInput "test-group`n[2]`n11:40" -expectedChatName "test-group" -expectedContent "test-group"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test7: Special chars" -testInput "work-group`n@user check file[file.pdf]`n[1]`n09:00" -expectedChatName "work-group" -expectedContent "@user check file[file.pdf]"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test8: Unicode chars" -testInput "party-group`nHappy New Year!`nYesterday 20:00" -expectedChatName "party-group" -expectedContent "Happy New Year!"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test9: Multiple time formats" -testInput "project-group`nMon 09:30`nAre you done`nToday 15:00" -expectedChatName "project-group" -expectedContent "Are you done"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test10: System message types" -testInput "work-group`n[Image]`n[10]`nscreenshot sent`n16:45" -expectedChatName "work-group" -expectedContent "screenshot sent"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test11: Time with seconds" -testInput "test-group`n11:40:30`nmessage`n12:00" -expectedChatName "test-group" -expectedContent "message"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test12: Voice call" -testInput "family-group`nVoiceCall 30sec`ncalled you`n10:15" -expectedChatName "family-group" -expectedContent "called you"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test13: Video call" -testInput "work-group`nVideoCall 120sec`nmeeting ended`n17:30" -expectedChatName "work-group" -expectedContent "meeting ended"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test14: Mixed system messages" -testInput "discussion`n[Image]`n[Video]`n[5]`nactual message`n18:00" -expectedChatName "discussion" -expectedContent "actual message"

$totalTests++; $passedTests += Test-ParseWeChatMessage -name "Test15: DND marker" -testInput "dnd-group`nDoNotDisturb`nsomeone sent msg`n09:30" -expectedChatName "dnd-group" -expectedContent "someone sent msg"

Write-Host ""
Write-Host "========== Test Results ==========" -ForegroundColor Cyan
Write-Host "Total: $totalTests tests" -ForegroundColor White
Write-Host "Passed: $passedTests" -ForegroundColor Green
$failedTests = $totalTests - $passedTests
Write-Host "Failed: $failedTests" -ForegroundColor $(if ($failedTests -gt 0) { "Red" } else { "Green" })
$passRate = [math]::Round($passedTests / $totalTests * 100, 2)
Write-Host "Pass Rate: $passRate%" -ForegroundColor $(if ($passedTests -eq $totalTests) { "Green" } else { "Yellow" })
Write-Host ""

if ($passedTests -eq $totalTests) {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some tests failed" -ForegroundColor Yellow
    exit 1
}

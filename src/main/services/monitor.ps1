# Configuration
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Define Data Directory Path
$scriptPath = $PSScriptRoot
$rootPath = Split-Path -Parent $scriptPath
$dataDir = Join-Path $rootPath "data"

# Create data directory if it doesn't exist (just in case)
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

$logFile = Join-Path $dataDir "monitor.log"
$configFile = Join-Path $dataDir "config.json"
$maxLogLines = 500
$DebugMode = $false # Set to true to enable debug logs

function Log-Message($msg) {
    if ($msg -match "^DEBUG:" -and -not $DebugMode) {
        return
    }

    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logEntry = "$timestamp - $msg"
    
    try {
        Add-Content -Path $logFile -Value $logEntry -Encoding UTF8 -ErrorAction SilentlyContinue
        
        # Simple log rotation based on file size to avoid locking issues
        $fileItem = Get-Item $logFile -ErrorAction SilentlyContinue
        if ($fileItem -and $fileItem.Length -gt 100KB) {
            $content = Get-Content $logFile -Tail $maxLogLines -ErrorAction SilentlyContinue
            if ($content) {
                $content | Set-Content $logFile -Encoding UTF8 -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        # Suppress all logging errors to prevent script crash
    }
}

function Get-MessageType {
    param([string]$fullTxt)
    
    $messageType = "text"
    
    if ($fullTxt -match "\[图片\]|\[Image\]") {
        $messageType = "image"
    } elseif ($fullTxt -match "\[动画表情\]|\[Emoji\]|\[表情\]") {
        $messageType = "sticker"
    } elseif ($fullTxt -match "\[视频\]|\[Video\]") {
        $messageType = "video"
    } elseif ($fullTxt -match "\[语音\]|\[Voice\]") {
        $messageType = "voice"
    } elseif ($fullTxt -match "\[文件\]|\[File\]") {
        $messageType = "file"
    } elseif ($fullTxt -match "\[链接\]|\[Link\]") {
        $messageType = "link"
    } elseif ($fullTxt -match "\[地理位置\]|\[Location\]") {
        $messageType = "location"
    }
    
    return $messageType
}

function Get-RevokerFromNotice {
    param([string]$notice)
    
    # Handle "Name 撤回了一条消息" or "Name recalled a message"
    if ($notice -match "^(.+?)\s*撤回了一条消息$") {
        return $matches[1]
    }
    if ($notice -match "^(.+?)\s*recalled a message$") {
        return $matches[1]
    }
    if ($notice -match "You recalled a message") {
        return "Current User"
    }
    if ($notice -match "你撤回了一条消息") {
        return "Current User"
    }
    # Handle Sidebar format "Name: 撤回了一条消息"
    if ($notice -match "^(.+?):\s*撤回了一条消息") {
        return $matches[1]
    }
    if ($notice -match "^(.+?):\s*recalled a message") {
        return $matches[1]
    }
    
    return "Unknown"
}

function Parse-WeChatMessage {
    param([string]$fullTxt)
    
    if ([string]::IsNullOrEmpty($fullTxt)) {
        Log-Message "Parse-WeChatMessage: Empty input"
        return @{ chatName = ""; messageContent = ""; messageType = "text" }
    }
    
    $lines = $fullTxt -split "`n" | Where-Object { $_.Trim() -ne "" }
    
    if ($lines.Count -eq 0) {
        Log-Message "Parse-WeChatMessage: No lines after split"
        return @{ chatName = ""; messageContent = ""; messageType = "text" }
    }
    
    $chatName = $lines[0]
    $messageType = Get-MessageType -fullTxt $fullTxt
    $isPinned = $false
    
    $skipPatterns = @(
        "^\[\d+条?\]$",
        "^\d{1,2}:\d{2}$",
        "^\d{1,2}:\d{2}:\d{2}$",
        "^(昨天|今天|前天)\s+\d{1,2}:\d{2}$",
        "^(周一|周二|周三|周四|周五|周六|周日)\s+\d{1,2}:\d{2}$",
        "^\d{4}-\d{2}-\d{2}$",
        "^[AM|PM]\s+\d{1,2}:\d{2}$",
        "消息免打扰",
        "^微信语音\s*$",
        "^语音通话\s*\d{1,3}秒$",
        "^视频通话\s*\d{1,3}秒$"
    )
    
    $contentLines = @()
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $line = $lines[$i].Trim()
        
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        
        # Check for Pinned status
        if ($line -eq "已置顶") {
            $isPinned = $true
            continue
        }
        
        $shouldSkip = $false
        foreach ($pattern in $skipPatterns) {
            if ($line -match $pattern) {
                # Log-Message "Parse-WeChatMessage: Skipped pattern '$pattern' - '$line'"
                $shouldSkip = $true
                break
            }
        }
        
        if (-not $shouldSkip) {
            $contentLines += $line
        }
    }
    
    if ($contentLines.Count -gt 0) {
        # Join multiple lines with a space to preserve content
        $messageContent = $contentLines -join " "
    } else {
        Log-Message "Parse-WeChatMessage: No valid content found, using chatName as fallback"
        $messageContent = $chatName
    }
    
    if ($isPinned) {
        $chatName = "$chatName [已置顶]"
    }
    
    Log-Message "Parse-WeChatMessage: chatName='$chatName', content='$messageContent', type='$messageType', lines=$($lines.Count)"
    
    return @{
        chatName = $chatName
        messageContent = $messageContent
        messageType = $messageType
    }
}

Log-Message "Starting Monitor Service V6 (History Anti-Recall)..."

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
} catch {
    Log-Message "FATAL: Failed to load UIAutomation assemblies."
    exit 1
}

# P/Invoke for Foreground Window Check
$typeDef = 'using System; using System.Runtime.InteropServices; public class User32 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'

try {
    Add-Type -TypeDefinition $typeDef -ErrorAction SilentlyContinue
} catch {
    Log-Message "Error adding type definition: $_"
}

function Get-WeChatWindow {
    $proc = Get-Process -Name "Weixin" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($null -ne $proc) {
        return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    }
    $proc = Get-Process -Name "WeChat" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($null -ne $proc) {
        return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    }
    $proc = Get-Process -Name "WeChatAppEx" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($null -ne $proc) {
        return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    }
    return $null
}

function Get-BadgeTextFromPosition($itemRect, $potentialBadges) {
    $result = 0
    foreach ($badge in $potentialBadges) {
        $badgeRect = $badge.Current.BoundingRectangle
        $name = $badge.Current.Name
        
        if ($badge.Current.ControlType.ProgrammaticName -ne "ControlType.Text") {
            continue
        }
        
        if (-not ($name -match "^\(\d+\)$")) {
            continue
        }
        
        $verticalOverlap = -not (($badgeRect.Bottom -lt $itemRect.Top) -or ($badgeRect.Top -gt $itemRect.Bottom))
        $horizontalOffset = $badgeRect.Left - $itemRect.Right
        
        if ($verticalOverlap -and $horizontalOffset -ge 0 -and $horizontalOffset -lt 100) {
            if ($name -match "^\((\d+)\)$") {
                $result = [int]$matches[1]
                break
            }
        }
    }
    return $result
}

function Scan-ActiveChatWindow($win, $chatName) {
    if ([string]::IsNullOrEmpty($chatName)) { return }
    
    Log-Message "Deep Scan: Scanning active chat '$chatName' for recalls..."
    
    # Find ListItems in the message area (right side)
    # Strategy: Find all ListItems, filter by X coordinate (> 25% of window width to include centered notices)
    
    $winRect = $win.Current.BoundingRectangle
    $sidebarBoundary = $winRect.X + ($winRect.Width * 0.25)
    
    $condList = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
    $allListItems = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condList)
    
    if ($null -eq $allListItems -or $allListItems.Count -eq 0) { return }
    
    # Convert to array for easier indexing
    $visibleMessages = @()
    foreach ($item in $allListItems) {
        try {
            $r = $item.Current.BoundingRectangle
            if ($r.Left -gt $sidebarBoundary) {
                $visibleMessages += $item
            }
        } catch {}
    }
    
    # Sort by Y coordinate (Top to Bottom) using double for correct numeric sorting
    $visibleMessages = $visibleMessages | Sort-Object { 
        try { [double]$_.Current.BoundingRectangle.Top } catch { 0 } 
    }
    
    Log-Message "Deep Scan: Found $($visibleMessages.Count) visible messages in chat area."

    # --- SYNC HISTORY (Active Window Scraping) ---
    if (-not $global:shadowInbox.ContainsKey($chatName)) {
        $global:shadowInbox[$chatName] = New-Object System.Collections.Generic.List[PSCustomObject]
    }
    $history = $global:shadowInbox[$chatName]
    
    # Extract text content from visible messages for sync
    $visibleTexts = $visibleMessages | ForEach-Object { $_.Current.Name }
    
    # Logic: Find overlap between History-Tail and Visible-Head
    # If History is empty, append ALL (assuming we just opened the chat)
    # If History has content, look for the LAST message of History in the Visible list.
    
    $itemsToAdd = @()
    
    if ($history.Count -eq 0) {
        # Initial population from active window
        foreach ($txt in $visibleTexts) {
             if ($txt -notmatch "撤回了一条消息" -and $txt -notmatch "recalled a message") {
                $itemsToAdd += $txt
             }
        }
        if ($itemsToAdd.Count -gt 0) {
             Log-Message "Sync History: Initial population of $($itemsToAdd.Count) messages."
        }
    } else {
        # Try to find the last history item in the visible list
        $lastHistoryMsg = $history[$history.Count - 1].content
        $matchIndex = -1
        
        # Search from top to bottom of visible list
        for ($k = 0; $k -lt $visibleTexts.Count; $k++) {
            if ($visibleTexts[$k] -eq $lastHistoryMsg) {
                $matchIndex = $k
                # Keep finding the LAST occurrence if there are duplicates? 
                # Usually checking from bottom up is safer but let's stick to first match for now or last match?
                # If we have duplicates, it's tricky. Let's assume unique enough.
            }
        }
        
        if ($matchIndex -ne -1) {
            # Found overlap! Append everything AFTER matchIndex
            for ($k = $matchIndex + 1; $k -lt $visibleTexts.Count; $k++) {
                $txt = $visibleTexts[$k]
                if ($txt -notmatch "撤回了一条消息" -and $txt -notmatch "recalled a message") {
                    $itemsToAdd += $txt
                }
            }
            if ($itemsToAdd.Count -gt 0) {
                 Log-Message "Sync History: Found overlap at index $matchIndex, appending $($itemsToAdd.Count) new messages."
            }
        } else {
            # No overlap found. 
            # Case A: User scrolled UP (Visible is older). Do nothing.
            # Case B: User received many messages and the 'last' one scrolled off top. (Gap).
            # In Case B, strictly we should append ALL, but we risk duplication if we are wrong about Case A.
            # For safety, we DO NOT append if no overlap is found.
            # BUT, if the visible list contains "Time" separators, matching might fail.
            # Let's just log this case.
            # Log-Message "Sync History: No overlap found. LastHistory='$lastHistoryMsg'"
        }
    }
    
    # Commit to History
    foreach ($txt in $itemsToAdd) {
        $history.Add([PSCustomObject]@{
            content = $txt
            timestamp = (Get-Date).ToString("HH:mm:ss")
        })
        # Keep size managed
        if ($history.Count -gt 50) { $history.RemoveAt(0) }
    }
    # ---------------------------------------------
    
    # Iterate to find Recall Notice
    for ($i = 0; $i -lt $visibleMessages.Count; $i++) {
        $item = $visibleMessages[$i]
        $text = $item.Current.Name
        
        if ($text -match "撤回了一条消息" -or $text -match "recalled a message") {
            Log-Message "Deep Scan: Found recall notice at index $i"
            
            # Context Matching
            # Try to get Next Message (Anchor)
            $nextContent = ""
            if (($i + 1) -lt $visibleMessages.Count) {
                $nextContent = $visibleMessages[$i+1].Current.Name
            }
            
            # Try to get Prev Message (Anchor)
            $prevContent = ""
            if (($i - 1) -ge 0) {
                $prevContent = $visibleMessages[$i-1].Current.Name
            }
            
            # Search in ShadowInbox
            if ($global:shadowInbox.ContainsKey($chatName)) {
                $history = $global:shadowInbox[$chatName]
                $foundIndex = -1
                
                # Strategy A: Match by Next Message
                if ($nextContent -ne "") {
                    for ($j = 0; $j -lt $history.Count; $j++) {
                        if ($history[$j].content -eq $nextContent) {
                            $foundIndex = $j - 1
                            Log-Message "Deep Scan: Matched by Next Content '$nextContent', target index $foundIndex"
                            break
                        }
                    }
                }
                
                # Strategy B: Match by Prev Message (if A failed)
                if ($foundIndex -eq -1 -and $prevContent -ne "") {
                     for ($j = 0; $j -lt $history.Count; $j++) {
                        if ($history[$j].content -eq $prevContent) {
                            $foundIndex = $j + 1
                            Log-Message "Deep Scan: Matched by Prev Content '$prevContent', target index $foundIndex"
                            break
                        }
                    }
                }
                
                if ($foundIndex -ge 0 -and $foundIndex -lt $history.Count) {
                    $recalledMsg = $history[$foundIndex]
                    
                    # Verify it's not the recall notice itself
                    if ($recalledMsg.content -notmatch "撤回了一条消息") {
                         # Dedup Check
                         $dedupKey = "$chatName|$($recalledMsg.content)"
                         if (-not $global:processedRecalls.Contains($dedupKey)) {
                             # Emit Event
                             Log-Message "RECALL DETECTED (History): $chatName -> $($recalledMsg.content)"
                             
                             $revoker = Get-RevokerFromNotice -notice $text
                             $recallEvent = @{ 
                                type = "recall"
                                title = $chatName 
                                content = "检测到历史撤回: $($recalledMsg.content)" 
                                originalContent = $recalledMsg.content 
                                recallNotice = $text
                                revoker = $revoker
                                timestamp = (Get-Date).ToString("HH:mm:ss") 
                            }
                            $json = $recallEvent | ConvertTo-Json -Compress
                            Write-Output $json
                            
                            $global:processedRecalls.Add($dedupKey) | Out-Null
                         } else {
                             Log-Message "Deep Scan: Skipping duplicate recall '$dedupKey'"
                         }
                    }
                }
            }
        }
    }
}

$lastMessageList = @()
$global:lastState = @{} # Hashtable to track message counts
$global:shadowInbox = @{} # Hashtable to track HISTORY: Key=Title, Value=List<PSCustomObject>
$global:processedRecalls = New-Object System.Collections.Generic.HashSet[string] # Track notified recalls
$global:lastActiveChat = ""
$global:scanCooldown = 0

while ($true) {
    try {
        $win = Get-WeChatWindow
        if ($null -eq $win) {
            Start-Sleep -Seconds 2
            continue
        }

        # Check Active State
        try {
            $fgHandle = [User32]::GetForegroundWindow()
        } catch {
            $fgHandle = 0
        }
        
        $winHandle = $win.Current.NativeWindowHandle
        $isWindowActive = ($fgHandle -eq $winHandle)
        $isUnread = -not $isWindowActive

        # Get Window Rect
        $winRect = $win.Current.BoundingRectangle
        if ($winRect.Width -eq 0) { 
            Start-Sleep -Milliseconds 200
            continue 
        }

        # Define Areas
        $msgAreaLeft = $winRect.X + ($winRect.Width * 0.28) 
        $inputAreaTop = $winRect.Top + ($winRect.Height * 0.80) 
        
        # 1. Find all ListItems (Chats)
        $condList = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
        $sidebarListItems = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condList)
        
        # Calculate Dynamic Sidebar Bounds
        $sidebarMinLeft = 10000
        $sidebarMaxRight = 0
        
        if ($sidebarListItems.Count -gt 0) {
            foreach ($item in $sidebarListItems) {
                try {
                    $r = $item.Current.BoundingRectangle
                    if ($r.Left -lt $sidebarMinLeft) { $sidebarMinLeft = $r.Left }
                    if (($r.Left + $r.Width) -gt $sidebarMaxRight) { $sidebarMaxRight = ($r.Left + $r.Width) }
                } catch {}
            }
        } else {
            # Fallback
            $sidebarMinLeft = 0
            $sidebarMaxRight = $winRect.Width * 0.4
        }

        # 2. Find ALL small elements (Potential Badges)
        $rawAll = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        
        $potentialBadges = @()
        foreach ($el in $rawAll) {
            try {
                $r = $el.Current.BoundingRectangle
                $name = $el.Current.Name
                # Filter: Small size AND (in sidebar OR has number in name)
                $isInSidebar = ($r.Left -ge ($sidebarMinLeft - 50) -and ($r.Left + $r.Width) -le ($sidebarMaxRight + 200))
                $hasNumber = ($name -match "\d+")
                
                if ($r.Width -gt 0 -and $r.Width -lt 100 -and $r.Height -lt 50 -and ($isInSidebar -or $hasNumber)) {
                    $potentialBadges += $el
                }
            } catch {}
        }
        
        $currentMsgs = @()
        $activeChatTitle = ""
        
        foreach ($el in $sidebarListItems) {
            try {
                $itemRect = $el.Current.BoundingRectangle
                $fullTxt = $el.Current.Name
                $badgeCount = 0
                $hasBadge = $false
                
                # Check Selection (Active Chat)
                try {
                    $selPattern = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                    if ($selPattern.Current.IsSelected) {
                        # We need to parse the name to get the Title
                        $parsed = Parse-WeChatMessage -fullTxt $fullTxt
                        $activeChatTitle = $parsed.chatName
                    }
                } catch {}

                # Filter out invalid ListItems based on position and size
                $sidebarRightEdge = $winRect.X + ($winRect.Width * 0.4)
                $minSidebarWidth = 200
                $maxSidebarWidth = 1200
                
                if ($itemRect.Width -lt $minSidebarWidth -or $itemRect.Width -gt $maxSidebarWidth -or $itemRect.Left -gt $sidebarRightEdge -or $itemRect.Height -lt 20) {
                    continue
                }
                
                # Position-based badge detection
                $badgeResult = Get-BadgeTextFromPosition -itemRect $itemRect -potentialBadges $potentialBadges
                if ($badgeResult -gt 0) {
                    $hasBadge = $true
                    $badgeCount = $badgeResult
                }
                
                # Text-based badge detection
                if (-not $hasBadge) {
                    if ($fullTxt.Length -gt 0) {
                        if ($fullTxt -match "\[(\d+)条\]") {
                             $badgeCount = [int]$matches[1]
                             $hasBadge = $true
                        }
                    }
                }
                
                if ($hasBadge) {
                    $result = Parse-WeChatMessage -fullTxt $fullTxt
                    $chatName = $result.chatName
                    $messageContent = $result.messageContent
                    $messageType = $result.messageType
                    
                    if ($fullTxt -match "消息免打扰") { continue }
                    
                    if ($chatName -match "公众号" -or $chatName -match "QQ邮箱提醒" -or $chatName -match "文件传输助手" -or $chatName -match "微信团队" -or $chatName -match "提醒" -or $chatName -match "通知") {
                        continue
                    }
                    
                    # --- NEW Anti-Recall Logic (History Based) ---
                    # 1. Update Shadow Inbox (Append Mode)
                    if (-not $global:shadowInbox.ContainsKey($chatName)) {
                        $global:shadowInbox[$chatName] = New-Object System.Collections.Generic.List[PSCustomObject]
                    }
                    $history = $global:shadowInbox[$chatName]
                    
                    # Deduplication (Check if last message is same)
                    $isNew = $true
                    if ($history.Count -gt 0) {
                        $lastMsg = $history[$history.Count - 1]
                        if ($lastMsg.content -eq $messageContent) { $isNew = $false }
                    }
                    
                    if ($isNew) {
                        # If content is NOT a recall notice, add to history
                        if ($messageContent -notmatch "撤回了一条消息" -and $messageContent -notmatch "recalled a message") {
                            $history.Add([PSCustomObject]@{
                                content = $messageContent
                                timestamp = (Get-Date).ToString("HH:mm:ss")
                            })
                            # Keep history size manageable
                            if ($history.Count -gt 50) { $history.RemoveAt(0) }
                            Log-Message "ShadowInbox: Appended to '$chatName' -> '$messageContent'"
                        } else {
                            # It IS a recall notice (Immediate Detection)
                            # Check last message in history (Previous Latest)
                            if ($history.Count -gt 0) {
                                $lastMsg = $history[$history.Count - 1]
                                
                                # Dedup Check
                                $dedupKey = "$chatName|$($lastMsg.content)"
                                if (-not $global:processedRecalls.Contains($dedupKey)) {
                                    Log-Message "RECALL DETECTED (Immediate): Chat='$chatName', Content='$($lastMsg.content)'"
                                    
                                    $revoker = Get-RevokerFromNotice -notice $messageContent
                                    $recallEvent = @{ 
                                        type = "recall"
                                        title = $chatName 
                                        content = "检测到撤回: $($lastMsg.content)" 
                                        originalContent = $lastMsg.content 
                                        recallNotice = $messageContent
                                        revoker = $revoker
                                        timestamp = (Get-Date).ToString("HH:mm:ss") 
                                    }
                                    $json = $recallEvent | ConvertTo-Json -Compress
                                    Write-Output $json
                                    
                                    $global:processedRecalls.Add($dedupKey) | Out-Null
                                } else {
                                    Log-Message "Immediate Scan: Skipping duplicate recall '$dedupKey'"
                                }
                            }
                        }
                    }
                    # -------------------------
                    
                    $msgObj = @{
                        type = "message"
                        title = $chatName
                        content = $messageContent
                        messageType = $messageType
                        count = $badgeCount
                        isUnread = $true
                        timestamp = (Get-Date).ToString("HH:mm:ss")
                    }
                    $currentMsgs += $msgObj
                }
            } catch {
                Log-Message "ERROR processing ListItem: $_"
            }
        }
        
        # --- Deep Scan Trigger ---
        # Trigger if:
        # 1. Window is active AND (ActiveChat changed OR Periodically)
        if ($isWindowActive -and $activeChatTitle -ne "") {
            $shouldScan = $false
            
            if ($activeChatTitle -ne $global:lastActiveChat) {
                Log-Message "Trigger: Chat changed to '$activeChatTitle'"
                $shouldScan = $true
                $global:lastActiveChat = $activeChatTitle
            }
            
            # Periodic scan (every 20 cycles ~ 2 seconds)
            $global:scanCooldown++
            if ($global:scanCooldown -gt 20) {
                $shouldScan = $true
                $global:scanCooldown = 0
            }
            
            if ($shouldScan) {
                Scan-ActiveChatWindow -win $win -chatName $activeChatTitle
            }
        }
        # -------------------------

        # Diff Logic with State Tracking (Fixes duplicate notifications)
        $currentTitles = @{}
        
        foreach ($msg in $currentMsgs) {
            $title = $msg.title
            $count = $msg.count
            $currentTitles[$title] = $true
            
            $shouldEmit = $false
            
            if (-not $global:lastState.ContainsKey($title)) {
                # New conversation or first detection
                $shouldEmit = $true
                Log-Message "Emit: $title - New conversation detected"
            } elseif ($count -gt $global:lastState[$title]) {
                # Message count increased
                $shouldEmit = $true
                Log-Message "Emit: $title - Count increased from $($global:lastState[$title]) to $count"
            }
            
            if ($shouldEmit) {
                $json = $msg | ConvertTo-Json -Compress
                Write-Output $json
            }
            
            # Update state
            $global:lastState[$title] = $count
        }
        
        # Cleanup removed conversations (Read or Disappeared)
        $titlesToRemove = @()
        foreach ($key in $global:lastState.Keys) {
            if (-not $currentTitles.ContainsKey($key)) {
                $titlesToRemove += $key
            }
        }
        foreach ($key in $titlesToRemove) {
            $global:lastState.Remove($key)
            Log-Message "State: Removed $key (read or disappeared)"
        }

        $lastMessageList = $currentMsgs
        
        Start-Sleep -Milliseconds 100

    } catch {
        Log-Message "Error in loop: $_"
        Start-Sleep -Seconds 1
    }
}

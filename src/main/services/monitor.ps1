<#
Monitor Service V6 - Fixed Encoding (BOM added)
#>
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
$chatHistoryFile = Join-Path $dataDir "chat_history_db.json"
$maxLogLines = 500
$DebugMode = $false 

function Log-Message($msg) {
    if ($msg -match "^DEBUG:" -and -not $DebugMode) {
        return
    }

    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logEntry = "$timestamp - $msg"
    
    try {
        Add-Content -Path $logFile -Value $logEntry -Encoding UTF8 -ErrorAction SilentlyContinue
        
        $fileItem = Get-Item $logFile -ErrorAction SilentlyContinue
        if ($fileItem -and $fileItem.Length -gt 100KB) {
            $content = Get-Content $logFile -Tail $maxLogLines -ErrorAction SilentlyContinue
            if ($content) {
                $content | Set-Content $logFile -Encoding UTF8 -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
    }
}

function Get-MD5Hash($inputString) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hashBytes = $md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($inputString))
    $hashString = [BitConverter]::ToString($hashBytes) -replace "-"
    return $hashString
}

function Load-ChatHistory {
    if (Test-Path $chatHistoryFile) {
        try {
            $jsonContent = Get-Content $chatHistoryFile -Raw -Encoding UTF8
            if ([string]::IsNullOrWhiteSpace($jsonContent)) {
                return @{}
            }
            
            $obj = $jsonContent | ConvertFrom-Json
            
            # Convert PSCustomObject to Hashtable
            $hashtable = @{}
            if ($obj) {
                $props = $obj | Get-Member -MemberType NoteProperty
                foreach ($prop in $props) {
                    $name = $prop.Name
                    $hashtable[$name] = $obj.$name
                }
            }
            
            Log-Message "Session Start: Loaded chat history db."
            return $hashtable
        } catch {
            Log-Message "Warning: Failed to load chat history db: $_"
            return @{}
        }
    }
    return @{}
}

function Save-ChatHistory {
    param($historyData)
    try {
        $json = $historyData | ConvertTo-Json -Depth 5 -Compress
        $json | Set-Content $chatHistoryFile -Encoding UTF8 -Force
    } catch {
        Log-Message "Error saving chat history: $_"
    }
}

# Global history cache
$global:chatHistory = Load-ChatHistory
$global:lastSaveTime = Get-Date
$global:isDirty = $false

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

function Test-IsSkipContent {
    param([string]$content)
    
    if ([string]::IsNullOrWhiteSpace($content)) { return $true }
    
    $skipPatterns = @(
        "^\[\d+条?\]$",
        "^\d{1,2}:\d{2}$",
        "^\d{1,2}:\d{2}:\d{2}$",
        "^(昨天|今天|前天)\s+\d{1,2}:\d{2}$",
        "^(周一|周二|周三|周四|周五|周六|周日)\s+\d{1,2}:\d{2}$",
        "^\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}$",
        "^\d{4}-\d{2}-\d{2}$",
        "^[AM|PM]\s+\d{1,2}:\d{2}$",
        "消息免打扰",
        "^微信语音\s*$",
        "^语音通话\s*\d{1,3}秒$",
        "^视频通话\s*\d{1,3}秒$",
        "^以下是新消息$",
        "^查看更多消息$",
        "^Start of new messages$"
    )
    
    foreach ($pattern in $skipPatterns) {
        if ($content -match $pattern) {
            return $true
        }
    }
    
    return $false
}

function Get-RevokerFromNotice {
    param([string]$notice)
    
    # Handle exact matches (DM or unknown)
    if ($notice -eq "撤回了一条消息") {
        return "Remote User"
    }
    if ($notice -eq "recalled a message") {
        return "Remote User"
    }

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
        
        if (Test-IsSkipContent -content $line) {
            continue
        }
        
        $contentLines += $line
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
    
    # Log-Message "Deep Scan: Scanning active chat '$chatName' for recalls..."
    
    $winRect = $win.Current.BoundingRectangle
    $sidebarBoundary = $winRect.X + ($winRect.Width * 0.25)
    
    $condList = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
    $allListItems = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condList)
    
    if ($null -eq $allListItems -or $allListItems.Count -eq 0) { return }
    
    $visibleMessages = @()
    foreach ($item in $allListItems) {
        try {
            $r = $item.Current.BoundingRectangle
            if ($r.Left -gt $sidebarBoundary) {
                $visibleMessages += $item
            }
        } catch {}
    }
    
    $visibleMessages = $visibleMessages | Sort-Object { 
        try { [double]$_.Current.BoundingRectangle.Top } catch { 0 } 
    }
    
    if (-not $global:chatHistory.ContainsKey($chatName)) {
        $global:chatHistory[$chatName] = @()
    }
    $history = $global:chatHistory[$chatName]
    
    # Construct visibleContentList for recall detection (READ ONLY)
    $visibleContentList = @()
    foreach ($msgItem in $visibleMessages) {
        $txt = $msgItem.Current.Name
        if ([string]::IsNullOrWhiteSpace($txt)) { continue }
        
        # Filter out timestamps and system messages
        if (Test-IsSkipContent -content $txt) {
            continue
        }
        
        if ($txt -match "撤回了一条消息" -or $txt -match "recalled a message") {
            $visibleContentList += @{ type = "recall"; content = $txt }
        } else {
            $visibleContentList += @{ type = "message"; content = $txt }
        }
    }

    # --- STEP 1: INGESTION (Restored) ---
    # We must save active chat messages to history to support anti-recall.
    foreach ($item in $visibleContentList) {
        if ($item.type -eq "message") {
            $msgContent = $item.content
            
            # Enrich with Sender Name from Sidebar (for Group Chats)
            $msgContent = Enrich-MessageWithSender -chatName $chatName -msgContent $msgContent
            
            $msgHash = Get-MD5Hash $msgContent
            
            # Check for duplicates in the ENTIRE current history (limited to 200)
            # This prevents re-adding old messages when scrolling up
            $isDuplicate = $false
            if ($history) {
                foreach ($hMsg in $history) {
                    if ($hMsg.hash -eq $msgHash) {
                        $isDuplicate = $true
                        break
                    }
                }
            }
            
            if (-not $isDuplicate) {
                $msgToSave = @{
                    content = $msgContent
                    timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    hash = $msgHash
                }
                
                $history += $msgToSave
            }
        }
    }
    
    # Update Global History
    $global:chatHistory[$chatName] = $history
    $global:isDirty = $true
    
    # Save logic moved to main loop (Debounced)

    # --- STEP 2: RECALL DETECTION (Sequence Diff) ---
    # Now we look for gaps between known messages
    
    for ($i = 0; $i -lt $visibleContentList.Count; $i++) {
        $item = $visibleContentList[$i]
        
        if ($item.type -eq "recall") {
            # Found a recall notice. Let's find Anchors.
            $prevAnchor = $null
            $nextAnchor = $null
            
            # Find closest PREV message and calculate offset
            $recallOffset = 0
            for ($p = $i - 1; $p -ge 0; $p--) {
                if ($visibleContentList[$p].type -eq "message") {
                    $prevAnchor = $visibleContentList[$p]
                    break
                }
                if ($visibleContentList[$p].type -eq "recall") {
                    $recallOffset++
                }
            }
            
            # Find closest NEXT message
            for ($n = $i + 1; $n -lt $visibleContentList.Count; $n++) {
                if ($visibleContentList[$n].type -eq "message") {
                    $nextAnchor = $visibleContentList[$n]
                    break
                }
            }
            
            # Locate in DB
            $prevIdx = -1
            $nextIdx = -1
            
            if ($prevAnchor) {
                # Search DB from end
                for ($h = $history.Count - 1; $h -ge 0; $h--) {
                    $histContent = $history[$h].content
                    $anchorContent = $prevAnchor.content
                    
                    $isMatch = ($histContent -eq $anchorContent)
                    if (-not $isMatch) {
                        # Fuzzy match for Group Chat (Name: Content)
                        if ($histContent -match ":\s*" + [regex]::Escape($anchorContent) + "$") {
                             $isMatch = $true
                        }
                    }
                    
                    if ($isMatch) {
                        $prevIdx = $h
                        break
                    }
                }
            }
            
            if ($nextAnchor) {
                # Search DB from end
                for ($h = $history.Count - 1; $h -ge 0; $h--) {
                    $histContent = $history[$h].content
                    $anchorContent = $nextAnchor.content
                    
                    $isMatch = ($histContent -eq $anchorContent)
                    if (-not $isMatch) {
                         # Fuzzy match for Group Chat (Name: Content)
                         if ($histContent -match ":\s*" + [regex]::Escape($anchorContent) + "$") {
                             $isMatch = $true
                        }
                    }
                    
                    if ($isMatch) {
                        $nextIdx = $h
                        break
                    }
                }
            }
            
            $targetMsg = $null
            
            if ($prevIdx -ne -1) {
                # Strategy: Anchor from Previous + Offset
                $targetIndex = $prevIdx + 1 + $recallOffset
                
                # Validation: 
                # 1. targetIndex must be within DB bounds
                # 2. If we have a NextAnchor, targetIndex must be < nextIdx
                
                $isValid = $true
                if ($targetIndex -ge $history.Count) {
                    $isValid = $false
                } elseif ($nextIdx -ne -1 -and $targetIndex -ge $nextIdx) {
                    $isValid = $false
                }
                
                if ($isValid) {
                    $targetMsg = $history[$targetIndex]
                }
            } elseif ($nextIdx -ne -1) {
                 # Strategy: Anchor from Next - Reverse Offset
                 $recallsUntilNext = 0
                 for ($n = $i + 1; $n -lt $visibleContentList.Count; $n++) {
                    if ($visibleContentList[$n].type -eq "message") { break }
                    if ($visibleContentList[$n].type -eq "recall") { $recallsUntilNext++ }
                 }
                 
                 $targetIndex = $nextIdx - 1 - $recallsUntilNext
                 if ($targetIndex -ge 0) {
                     $targetMsg = $history[$targetIndex]
                 }
            }
            
            if ($targetMsg) {
                 # Check if this specific recall has been processed
                 # Use "Chat + Content + Time" to dedup? Or just Chat+Content
                 $dedupKey = "$chatName|$($targetMsg.content)"
                 
                 if (-not $global:processedRecalls.Contains($dedupKey)) {
                     Log-Message "RECALL DETECTED: $chatName -> $($targetMsg.content)"
                     
                     $revoker = Get-RevokerFromNotice -notice $item.content
                     $recallEvent = @{ 
                        type = "recall"
                        title = $chatName 
                        content = "检测到撤回: $($targetMsg.content)" 
                        originalContent = $targetMsg.content 
                        recallNotice = $item.content
                        revoker = $revoker
                        timestamp = (Get-Date).ToString("HH:mm:ss") 
                    }
                    $json = $recallEvent | ConvertTo-Json -Compress
                    Write-Output $json
                    
                    $global:processedRecalls.Add($dedupKey) | Out-Null
                 }
            }
        }
    }
}

$lastMessageList = @()
$global:lastState = @{} # Hashtable to track message counts
$global:missedCounts = @{} # Hashtable to track missed scans for debounce
$global:zombieStates = @{} # Hashtable to track recently removed states (Anti-Flapping)
# $global:shadowInbox removed, using $global:chatHistory
$global:processedRecalls = New-Object System.Collections.Generic.HashSet[string] # Track notified recalls
$global:lastActiveChat = ""
$global:scanCooldown = 0
$global:latestSidebarInfo = @{} # Track latest sidebar preview for each chat

function Enrich-MessageWithSender {
    param($chatName, $msgContent)
    
    if (-not $global:latestSidebarInfo.ContainsKey($chatName)) {
        return $msgContent
    }
    
    $sidebarContent = $global:latestSidebarInfo[$chatName]
    if ([string]::IsNullOrWhiteSpace($sidebarContent)) {
        return $msgContent
    }
    
    # Sidebar format: "Sender: Content" or "Content"
    # We try to extract Sender if Sidebar Content ends with MsgContent
    
    # 1. Exact match (Sidebar is "Sender: Content", Msg is "Content")
    # Using regex escape for content
    $escapedMsg = [regex]::Escape($msgContent)
    if ($sidebarContent -match "^(.+?):\s*" + $escapedMsg + "$") {
        return $sidebarContent # Use the full Sidebar content which includes sender
    }
    
    # 2. If msgContent is a suffix of sidebarContent (handle truncation?)
    # If Sidebar is "Tom: Hello World", Msg is "Hello World"
    # Done by regex above.
    
    return $msgContent
}

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

                # Capture Sidebar Info for Group Chat Sender Extraction
                try {
                    $parsedInfo = Parse-WeChatMessage -fullTxt $fullTxt
                    if (-not [string]::IsNullOrEmpty($parsedInfo.chatName)) {
                        $global:latestSidebarInfo[$parsedInfo.chatName] = $parsedInfo.messageContent
                    }
                } catch {}
                
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
                    
                    # Legacy ShadowInbox logic removed
                    
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
                # CHECK ZOMBIE STATE (Anti-Flapping)
                $isResurrected = $false
                if ($global:zombieStates.ContainsKey($title)) {
                    $zombie = $global:zombieStates[$title]
                    # If removed less than 30 seconds ago
                    if ((Get-Date) -lt $zombie.time.AddSeconds(30)) {
                        if ($count -le $zombie.count) {
                            # It's just a flicker/scroll/recall effect. Do not emit.
                            Log-Message "Suppress: $title - Resurrected from zombie state (Count: $count)"
                            $isResurrected = $true
                        } else {
                            Log-Message "Emit: $title - Resurrected but count increased ($($zombie.count) -> $count)"
                        }
                    } else {
                        # Zombie expired
                        $global:zombieStates.Remove($title)
                    }
                }

                if (-not $isResurrected) {
                    $shouldEmit = $true
                    Log-Message "Emit: $title - New conversation detected"
                }
            } elseif ($count -gt $global:lastState[$title]) {
                # Message count increased
                $shouldEmit = $true
                Log-Message "Emit: $title - Count increased from $($global:lastState[$title]) to $count"
            }
            
            # Anti-Recall: Handle Recall Notices in Sidebar (Background Recall)
            if ($msg.content -match "撤回了一条消息" -or $msg.content -match "recalled a message") {
                $shouldEmit = $false # Suppress standard "New Message" notification
                
                # Try to find the original message from history
                if ($global:chatHistory.ContainsKey($title) -and $global:chatHistory[$title].Count -gt 0) {
                    $lastMsg = $global:chatHistory[$title][-1]
                    
                    # Dedup: Check if we already processed this recall (based on timestamp/content)
                    # For sidebar recalls, we might scan it multiple times.
                    # We use a composite key: ChatName + LastMsgHash + "SidebarRecall"
                    $dedupKey = "Sidebar|$title|$($lastMsg.hash)"
                    
                    if (-not $global:processedRecalls.Contains($dedupKey)) {
                         Log-Message "SIDEBAR RECALL DETECTED: $title -> $($lastMsg.content)"
                         
                         $revoker = Get-RevokerFromNotice -notice $msg.content
                         
                         $recallEvent = @{ 
                            type = "recall"
                            title = $title 
                            content = "检测到撤回: $($lastMsg.content)" 
                            originalContent = $lastMsg.content 
                            recallNotice = $msg.content
                            revoker = $revoker
                            timestamp = (Get-Date).ToString("HH:mm:ss") 
                        }
                        $json = $recallEvent | ConvertTo-Json -Compress
                        Write-Output $json
                        
                        $global:processedRecalls.Add($dedupKey) | Out-Null
                    }
                }
            }
            
            if ($shouldEmit) {
                # Sidebar logic: Only emit notification, DO NOT save to DB.
                # User Requirement: Only save "Message Popup" (Active Chat Content) to DB.
                # Sidebar previews are often truncated and not reliable for anti-recall.
                
                # REVERTED LOGIC: User explicitly requested to save MESSAGES that trigger a POPUP.
                # Since the "popup" (notification) is triggered here, we MUST save this content.
                # Although it might be a summary, it is what the user wants to anti-recall.
                # Filter out recall notices themselves.
                
                if ($msg.content -notmatch "撤回了一条消息" -and $msg.content -notmatch "recalled a message") {
                     $msgHash = Get-MD5Hash $msg.content
                     $msgToSave = @{
                        content = $msg.content
                        timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                        hash = $msgHash
                     }
                     
                     if (-not $global:chatHistory.ContainsKey($title)) {
                        $global:chatHistory[$title] = @()
                     }
                     $global:chatHistory[$title] += $msgToSave
                     
                     # Limit history size (Keep last 200)
                     if ($global:chatHistory[$title].Count -gt 200) {
                        $global:chatHistory[$title] = $global:chatHistory[$title][($global:chatHistory[$title].Count - 200)..($global:chatHistory[$title].Count - 1)]
                     }
                     
                     # Mark as dirty for main loop to save
                     $global:isDirty = $true
                }
                
                $json = $msg | ConvertTo-Json -Compress
                Write-Output $json
            }
            
            # Update state
            $global:lastState[$title] = $count
            # Reset missed count since we found it
            if ($global:missedCounts.ContainsKey($title)) {
                $global:missedCounts[$title] = 0
            }
        }
        
        # Cleanup removed conversations (Read or Disappeared) WITH DEBOUNCE
        $titlesToRemove = @()
        foreach ($key in $global:lastState.Keys) {
            if (-not $currentTitles.ContainsKey($key)) {
                # Increment missed count
                if (-not $global:missedCounts.ContainsKey($key)) {
                    $global:missedCounts[$key] = 0
                }
                $global:missedCounts[$key]++
                
                # Only remove if missed for > 10 consecutive scans (approx 1-2 seconds)
                if ($global:missedCounts[$key] -gt 10) {
                    $titlesToRemove += $key
                }
            }
        }
        foreach ($key in $titlesToRemove) {
            # Save to Zombie State before removing
            $global:zombieStates[$key] = @{
                count = $global:lastState[$key]
                time = Get-Date
            }
            
            $global:lastState.Remove($key)
            $global:missedCounts.Remove($key)
            Log-Message "State: Removed $key (read or disappeared) -> Zombie"
        }

        $lastMessageList = $currentMsgs
        
        # --- GLOBAL SAVE CHECK ---
        if ($global:isDirty -and (Get-Date) -gt $global:lastSaveTime.AddSeconds(1)) {
            Save-ChatHistory -historyData $global:chatHistory
            $global:lastSaveTime = Get-Date
            $global:isDirty = $false
        }
        
        Start-Sleep -Milliseconds 100

    } catch {
        Log-Message "Error in loop: $_"
        Start-Sleep -Seconds 1
    }
}

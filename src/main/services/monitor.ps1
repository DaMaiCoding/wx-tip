# Configuration
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$logFile = Join-Path $PSScriptRoot "monitor.log"
$configFile = Join-Path $PSScriptRoot "config.json"
$maxLogLines = 200

function Log-Message($msg) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logEntry = "$timestamp - $msg"
    try {
        $logEntry | Out-File -FilePath $logFile -Append -Encoding utf8 -ErrorAction SilentlyContinue
        
        $lines = Get-Content $logFile -ErrorAction SilentlyContinue
        if ($lines -and $lines.Count -gt $maxLogLines) {
            $tempFile = $logFile + ".tmp"
            $lines | Select-Object -Last $maxLogLines | Out-File -FilePath $tempFile -Encoding utf8
            Move-Item -Path $tempFile -Destination $logFile -Force
        }
    } catch {}
}

Log-Message "Starting Monitor Service V5 (Clean ASCII Quotes)..."

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
        
        Log-Message "DEBUG: Checking badge '$name' [$($badgeRect.Left),$($badgeRect.Top)] vs ListItem [$($itemRect.Left),$($itemRect.Top)] - verticalOverlap=$verticalOverlap, offset=$horizontalOffset"
        
        if ($verticalOverlap -and $horizontalOffset -ge 0 -and $horizontalOffset -lt 100) {
            if ($name -match "^\((\d+)\)$") {
                $result = [int]$matches[1]
                Log-Message "DEBUG: MATCHED badge $name with offset $horizontalOffset"
                break
            }
        }
    }
    return $result
}

$lastMessageList = @()
$emittedSignatures = @{} # Hashtable to track emitted messages

function Get-MessageSignature($msg) {
    return "$($msg.title)|$($msg.count)"
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
            Start-Sleep -Seconds 1
            continue 
        }

        # Define Areas
        $msgAreaLeft = $winRect.X + ($winRect.Width * 0.28) 
        $inputAreaTop = $winRect.Top + ($winRect.Height * 0.80) 

        Log-Message "DEBUG: WinRect: [$($winRect.X), $($winRect.Y), $($winRect.Width), $($winRect.Height)]"
        
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

        # 2. Find ALL small elements (Potential Badges: Text, Image, Pane, etc.)
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
                    Log-Message "DEBUG: Potential Badge Candidate: Type=$($el.Current.ControlType.ProgrammaticName), Name='$($name)', Rect=[$($r.Left),$($r.Top),$($r.Width),$($r.Height)], InSidebar=$isInSidebar, HasNumber=$hasNumber"
                }
            } catch {}
        }
        
        Log-Message "DEBUG: Found $($sidebarListItems.Count) Sidebar ListItems and $($potentialBadges.Count) Potential Badges"

        $currentMsgs = @()
        
        foreach ($el in $sidebarListItems) {
            try {
                $itemRect = $el.Current.BoundingRectangle
                $fullTxt = $el.Current.Name
                $badgeCount = 0
                $hasBadge = $false
                
                # Escape single quotes for logging
                $safeTxt = $fullTxt -replace "'", "''"
                Log-Message "DEBUG: Processing ListItem - Name: '$safeTxt', Rect: [$($itemRect.Left),$($itemRect.Top),$($itemRect.Width),$($itemRect.Height)]"
                
                # Filter out invalid ListItems based on position and size
                $sidebarRightEdge = $winRect.X + ($winRect.Width * 0.4)
                $minSidebarWidth = 200
                $maxSidebarWidth = 1200
                
                # Valid sidebar ListItems: reasonable width AND left position in sidebar area
                if ($itemRect.Width -lt $minSidebarWidth -or $itemRect.Width -gt $maxSidebarWidth -or $itemRect.Left -gt $sidebarRightEdge -or $itemRect.Height -lt 20) {
                    Log-Message "DEBUG: Skipped invalid ListItem (Width: $($itemRect.Width), Left: $($itemRect.Left), SidebarRightEdge: $sidebarRightEdge, Height: $($itemRect.Height))"
                    continue
                }
                
                # Position-based badge detection
                $badgeResult = Get-BadgeTextFromPosition -itemRect $itemRect -potentialBadges $potentialBadges
                if ($badgeResult -gt 0) {
                    $hasBadge = $true
                    $badgeCount = $badgeResult
                    Log-Message "DEBUG: Found badge count $badgeCount for position-based"
                }
                
                # Text-based badge detection (e.g., "[2条]")
                if (-not $hasBadge) {
                    Log-Message "DEBUG: Checking text-based badge pattern"
                    
                    # Debug: Show first 100 chars of text
                    if ($fullTxt.Length -gt 0) {
                        $debugTxt = $fullTxt.Substring(0, [Math]::Min(100, $fullTxt.Length))
                        Log-Message "DEBUG: Text preview: '$debugTxt'"
                        Log-Message "DEBUG: Text length: $($fullTxt.Length)"
                        
                        # Check for [X条] pattern with regex (ASCII only)
                        
                        # Debug: Check for bracket characters
                        $hasOpenBracket = $false
                        $hasCloseBracket = $false
                        foreach ($char in $fullTxt.ToCharArray()) {
                            if ($char -eq '[') { $hasOpenBracket = $true }
                            if ($char -eq ']') { $hasCloseBracket = $true }
                        }
                        Log-Message "DEBUG: Has brackets - open: $hasOpenBracket, close: $hasCloseBracket"
                        
                        if ($hasOpenBracket -and $hasCloseBracket) {
                            # Debug: Find bracket positions and check content
                            $openIdx = $fullTxt.IndexOf("[")
                            $closeIdx = $fullTxt.IndexOf("]")
                            if ($openIdx -ge 0 -and $closeIdx -gt $openIdx) {
                                $content = $fullTxt.Substring($openIdx + 1, $closeIdx - $openIdx - 1)
                                Log-Message "DEBUG: Bracket content: '$content'"
                                
                                # Try to extract number
                                if ($content -match "^(\d+)") {
                                    $num = $matches[1]
                                    Log-Message "DEBUG: Found number in brackets: $num"
                                    
                                    if ($content -match "^$num条") {
                                        $badgeCount = [int]$num
                                        $hasBadge = $true
                                        Log-Message "DEBUG: Found badge count $badgeCount (manual check)"
                                    } else {
                                        Log-Message "DEBUG: Content does not match 'N条' pattern"
                                    }
                                }
                            }
                            
                            # Try regex as fallback
                            if (-not $hasBadge) {
                                $match1 = [regex]::Match($fullTxt, "(?s)\[(\d+)条\]")
                                if ($match1.Success) {
                                    $badgeCount = [int]$match1.Groups[1].Value
                                    $hasBadge = $true
                                    Log-Message "DEBUG: Found Text-based Badge count $badgeCount (pattern [X条])"
                                } else {
                                    Log-Message "DEBUG: No text-based badge pattern found (regex failed)"
                                }
                            }
                        } else {
                            Log-Message "DEBUG: No brackets found in text (skipping regex)"
                        }
                    }
                }
                
                if ($hasBadge) {
                    $chatName = $fullTxt
                    $content = $fullTxt
                    
                    $msgObj = @{
                        type = "message"
                        title = $chatName
                        content = $content
                        count = $badgeCount
                        isUnread = $true
                        timestamp = (Get-Date).ToString("HH:mm:ss")
                    }
                    $currentMsgs += $msgObj
                    Log-Message "DEBUG: Added message to currentMsgs: $chatName (count: $badgeCount)"
                } else {
                    $safeTxt = $fullTxt -replace "'", "''"
                    Log-Message "DEBUG: No badge found for '$safeTxt'"
                }
            } catch {
                Log-Message "ERROR processing ListItem: $_"
            }
        }

        # Diff Logic with Improved Deduplication
        foreach ($msg in $currentMsgs) {
            $sig = Get-MessageSignature $msg
            $now = Get-Date
            $lastEmitTime = $null
            $shouldEmit = $false
            
            if ($emittedSignatures.ContainsKey($sig)) {
                $lastEmitTime = $emittedSignatures[$sig]
                $timeDiff = ($now - $lastEmitTime).TotalSeconds
                
                if ($timeDiff -gt 3) {
                    $shouldEmit = $true
                    $emittedSignatures[$sig] = $now
                    Log-Message "Emit: $($msg.title) - Count: $($msg.count) (Unread: $isUnread) - Re-emitted after ${timeDiff}s"
                } else {
                    Log-Message "Skip: $($msg.title) - Count: $($msg.count) - Last emitted ${timeDiff}s ago"
                }
            } else {
                $shouldEmit = $true
                $emittedSignatures[$sig] = $now
                Log-Message "Emit: $($msg.title) - Count: $($msg.count) (Unread: $isUnread) - First time"
            }
            
            if ($shouldEmit) {
                $json = $msg | ConvertTo-Json -Compress
                Write-Output $json
            }
        }

        $lastMessageList = $currentMsgs
        
        # Cleanup old signatures (every 10 loops)
        if ($global:cleanupCounter -eq $null) { $global:cleanupCounter = 0 }
        $global:cleanupCounter++
        if ($global:cleanupCounter -ge 10) {
            $global:cleanupCounter = 0
            $now = Get-Date
            $keysToRemove = @()
            foreach ($key in $emittedSignatures.Keys) {
                $age = ($now - $emittedSignatures[$key]).TotalSeconds
                if ($age -gt 60) {
                    $keysToRemove += $key
                }
            }
            foreach ($key in $keysToRemove) {
                $emittedSignatures.Remove($key)
                Log-Message "Cleanup: Removed old signature for $key"
            }
        }

        Start-Sleep -Milliseconds 500

    } catch {
        Log-Message "Error in loop: $_"
        Start-Sleep -Seconds 1
    }
}

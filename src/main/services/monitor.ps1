# Configuration
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$logFile = Join-Path $PSScriptRoot "monitor.log"
$configFile = Join-Path $PSScriptRoot "config.json"
# Default Configuration: Native ON, Custom OFF
$config = @{ 
    enableNativeNotification = $true
    enableCustomPopup = $false 
}

if (Test-Path $configFile) {
    try {
        $json = Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.enableNativeNotification -ne $null) {
            $config.enableNativeNotification = $json.enableNativeNotification
        }
        if ($json.enableCustomPopup -ne $null) {
            $config.enableCustomPopup = $json.enableCustomPopup
        }
        # Backward compatibility
        if ($json.useCustomPopup -ne $null) {
            $config.enableCustomPopup = $json.useCustomPopup
        }
    } catch {
        Log-Message "Error reading config file: $($_.Exception.Message)"
    }
}

$lastMessageContent = ""
$lastCheckTime = Get-Date

function Log-Message($msg) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logEntry = "$timestamp - $msg"
    
    # Simple retry logic for file locking
    for ($i = 0; $i -lt 3; $i++) {
        try {
            $logEntry | Out-File -FilePath $logFile -Append -Encoding utf8 -ErrorAction Stop
            break
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
}

Log-Message "Starting Monitor Service..."

try {
    # Required Assemblies for UI Automation
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Log-Message "Assemblies loaded successfully."
} catch {
    Log-Message "FATAL ERROR loading assemblies: $($_.Exception.Message)"
    exit 1
}

# Initialize NotifyIcon (Standard Windows Notification)
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
try {
    $iconPath = Join-Path $PSScriptRoot "..\..\..\assets\icon.ico"
    if (Test-Path $iconPath) {
        $notifyIcon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($iconPath)
    } else {
        $notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
    }
    $notifyIcon.Visible = $true
} catch {
    Log-Message "Warning: Failed to setup NotifyIcon: $($_.Exception.Message)"
}

function Show-Notification($title, $text) {
    try {
        # 1. Map WeChat text tags to Unicode Emojis for better visualization
        $map = @{
            '\[捂脸\]' = "🤦";
            '\[呲牙\]' = "😁";
            '\[偷笑\]' = "🤭";
            '\[发呆\]' = "😳";
            '\[流泪\]' = "😭";
            '\[微笑\]' = "🙂";
            '\[大哭\]' = "😭";
            '\[害羞\]' = "😊";
            '\[再见\]' = "👋";
            '\[擦汗\]' = "😓";
            '\[抠鼻\]' = "👃";
            '\[鼓掌\]' = "👏";
            '\[坏笑\]' = "😏";
            '\[右哼哼\]' = "😤";
            '\[鄙视\]' = "👎";
            '\[委屈\]' = "🥺";
            '\[快哭了\]' = "😿";
            '\[亲亲\]' = "😘";
            '\[强\]' = "👍";
            '\[弱\]' = "👎";
            '\[握手\]' = "🤝";
            '\[胜利\]' = "✌️";
            '\[抱拳\]' = "🙏";
            '\[玫瑰\]' = "🌹";
            '\[凋谢\]' = "🥀";
            '\[炸弹\]' = "💣";
            '\[图片\]' = "🖼️ [图片]";
            '\[视频\]' = "🎥 [视频]";
            '\[文件\]' = "📄 [文件]";
            '\[小程序\]' = "🔗 [小程序]";
            '\[红包\]' = "🧧 [红包]";
            '\[转账\]' = "💰 [转账]";
        }
        
        $displayMsg = $text
        foreach ($key in $map.Keys) {
            $displayMsg = $displayMsg -replace $key, $map[$key]
        }

        # --- CUSTOM POPUP (Optional) ---
        if ($config.enableCustomPopup) {
            # Create a temp JSON file with payload
            $tmpFile = [System.IO.Path]::GetTempFileName()
            $payload = @{
                title = $title
                text = $displayMsg
            }
            $payload | ConvertTo-Json -Compress | Set-Content -Path $tmpFile -Encoding UTF8

            # Start child process passing the temp file path
            Start-Process powershell -ArgumentList "-WindowStyle Hidden", "-Command", "& {
                param(`$dataFile)
                
                try {
                    Add-Type -AssemblyName System.Windows.Forms
                    Add-Type -AssemblyName System.Drawing
                    
                    # Read payload
                    `$json = Get-Content `$dataFile -Raw -Encoding UTF8 | ConvertFrom-Json
                    `$title = `$json.title
                    `$text = `$json.text
                    
                    # Clean up temp file immediately
                    Remove-Item `$dataFile -Force -ErrorAction SilentlyContinue

                    `$form = New-Object System.Windows.Forms.Form
                    `$form.Size = New-Object System.Drawing.Size(400, 120)
                    `$form.FormBorderStyle = 'None'
                    `$form.TopMost = `$true
                    `$form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
                    `$form.Opacity = 0.95
                    `$screen = [System.Windows.Forms.Screen]::PrimaryScreen
                    `$form.Location = New-Object System.Drawing.Point((`$screen.WorkingArea.Right - 420), (`$screen.WorkingArea.Bottom - 140))
                    
                    # Title
                    `$lblTitle = New-Object System.Windows.Forms.Label
                    `$lblTitle.Text = `$title
                    `$lblTitle.Font = New-Object System.Drawing.Font('Segoe UI Emoji', 11, [System.Drawing.FontStyle]::Bold)
                    `$lblTitle.ForeColor = [System.Drawing.Color]::White
                    `$lblTitle.Location = New-Object System.Drawing.Point(15, 12)
                    `$lblTitle.AutoSize = `$true
                    `$form.Controls.Add(`$lblTitle)

                    # Message
                    `$lblMsg = New-Object System.Windows.Forms.Label
                    `$lblMsg.Text = `$text
                    `$lblMsg.Font = New-Object System.Drawing.Font('Segoe UI Emoji', 11)
                    `$lblMsg.ForeColor = [System.Drawing.Color]::LightGray
                    `$lblMsg.Location = New-Object System.Drawing.Point(15, 40)
                    `$lblMsg.Size = New-Object System.Drawing.Size(370, 60)
                    `$lblMsg.TextAlign = 'TopLeft'
                    `$form.Controls.Add(`$lblMsg)

                    `$form.Add_Load({ `$form.Activate() })
                    
                    # Auto-close timer
                    `$timer = New-Object System.Windows.Forms.Timer
                    `$timer.Interval = 6000
                    `$timer.Add_Tick({ `$form.Close() })
                    `$timer.Start()
                    
                    # Close on click
                    `$form.Add_Click({ `$form.Close() })
                    `$lblMsg.Add_Click({ `$form.Close() })
                    
                    [System.Windows.Forms.Application]::Run(`$form)
                } catch {
                    # Log error to a temp error log if needed, or just exit
                }
            }", "`"$tmpFile`"" -WindowStyle Hidden
        }

        # --- STANDARD NOTIFICATION (Optional, Enabled by default) ---
        if ($config.enableNativeNotification) {
            if ($null -ne $notifyIcon) {
                $notifyIcon.BalloonTipTitle = $title
                $notifyIcon.BalloonTipText = $displayMsg
                $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
                $notifyIcon.ShowBalloonTip(3000)
            }
        }
    } catch {
        Log-Message "Failed to show notification: $($_.Exception.Message)"
    }
}

function Get-WeChatWindow {
    # Try finding by Name "微信" (Chinese)
    $condCN = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "微信")
    $win = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condCN)
    
    # Try finding by Name "WeChat" (English)
    if ($null -eq $win) {
        $condEN = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "WeChat")
        $win = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condEN)
    }

    # Fallback: Try finding by Process Handle (if window name changed or is different)
    if ($null -eq $win) {
        # Try 'Weixin' process (common in newer versions)
        $proc = Get-Process -Name "Weixin" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($null -ne $proc) {
            try {
                $win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
                Log-Message "Found window via 'Weixin' process handle: $($proc.Id)"
            } catch {
                Log-Message "Failed to get element from 'Weixin' handle: $($_.Exception.Message)"
            }
        }
    }

    if ($null -eq $win) {
        # Try 'WeChat' process (older/English versions)
        $proc = Get-Process -Name "WeChat" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($null -ne $proc) {
            try {
                $win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
                Log-Message "Found window via 'WeChat' process handle: $($proc.Id)"
            } catch {
                Log-Message "Failed to get element from 'WeChat' handle: $($_.Exception.Message)"
            }
        }
    }

    return $win
}

# Strategy: Find all Text elements, sort by Y coordinate (Bottom to Top)
# The latest message is usually at the bottom of the message list area.
# We need to exclude the Input Area which is also at the bottom.
function Get-LatestMessage-ByCoordinates($window) {
    if ($null -eq $window) { return $null }

    try {
        # 1. Get Window Bounds
        $winRect = $window.Current.BoundingRectangle
        if ($winRect.Width -eq 0) { 
            Log-Message "Window width is 0"
            return $null 
        }
        # Log-Message "Window Bounds: Left:$($winRect.Left) Top:$($winRect.Top) Width:$($winRect.Width) Height:$($winRect.Height)"

        # Define Areas
        # Left Sidebar: ~0-25% width (Session List) -> Ignore
        # Message Area: ~25%-100% width
        # Input Area: Usually the bottom 20-30% of the window -> Need to be careful
        
        $msgAreaLeft = $winRect.X + ($winRect.Width * 0.25)
        # Relax Input Area: Only exclude the very bottom 15% (usually input area is small)
        $inputAreaTop = $winRect.Top + ($winRect.Height * 0.85) 

        # Calculate "Sent Message" Threshold (Right 40% of the window usually contains Sent messages)
        # Received messages are left-aligned in the message area.
        # Message Area Width = 75% of Window Width.
        # Center of Message Area = msgAreaLeft + (MessageAreaWidth / 2)
        # Heuristic: If Text.Left > (msgAreaLeft + 100px), it might be Sent? 
        # Actually, WeChat "Sent" messages are right-aligned. "Received" are left-aligned (near avatar).
        # Let's define "Received" as: Left < (msgAreaLeft + WindowWidth * 0.35)
        $receivedThresholdX = $msgAreaLeft + ($winRect.Width * 0.45) # Allow some width for long messages, but usually they start left.
        # Wait, the Text element inside the bubble might be wide? No, usually automation element is the text itself.
        # If it's a long paragraph, the text block starts at left (for received) or right (for sent)?
        # Actually, for Sent messages, the text block *starts* further right.
        # Let's use a safe threshold.


        # 2. Find ALL Text Elements
        $condText = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
        $allTexts = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condText)
        
        # Also try to find ListItem elements (sometimes messages are ListItems)
        $condList = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
        $allListItems = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condList)

        # Also try to find Pane elements (sometimes messages are in Panes)
        $condPane = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Pane)
        $allPanes = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condPane)

        Log-Message "Found $($allTexts.Count) Texts, $($allListItems.Count) ListItems, $($allPanes.Count) Panes. Window: [$($winRect.Left),$($winRect.Top),$($winRect.Width),$($winRect.Height)] MsgAreaLeft: $msgAreaLeft"

        # 3. Filter and Sort
        $candidates = @()
        
        $processList = $allTexts + $allListItems + $allPanes

        foreach ($el in $processList) {
            try {
                $rect = $el.Current.BoundingRectangle
                $txt = $el.Current.Name

                # Filter empty
                if ([string]::IsNullOrWhiteSpace($txt)) { continue }

                # Normalize text
                $txtClean = $txt.Trim()

                # Filter System Buttons (Robust Regex)
                # Matches: "发送(S)", "Send(S)", "截图", "Screenshot", "文件", "File", "微信", "WeChat"
                # Use Unicode escapes to avoid encoding issues in regex: \u53d1\u9001=发送, \u622a\u56fe=截图, \u6587\u4ef6=文件, \u5fae\u4fe1=微信
                # Use anchors (^) and ($) to match exact strings only, preventing false positives (e.g. messages containing "WeChat")
                if ($txtClean -match "^(\u53d1\u9001\(S\)|Send\(S\)|\u622a\u56fe|Screenshot|\u6587\u4ef6|File|\u5fae\u4fe1|WeChat)$") { 
                    # Log-Message "Filtered (Blacklist): [$txtClean]"
                    continue 
                }
                
                # Debug: Log everything found in the "Message Area" (Right 75%)
                if ($rect.Left -gt $msgAreaLeft) {
                     # Log-Message "Raw Candidate: [$txt] (Type: $($el.Current.ControlType.ProgrammaticName)) at Left:$($rect.Left) Top:$($rect.Top) Bottom:$($rect.Bottom)"
                }

                # Filter by Position
                if ($rect.Left -lt $msgAreaLeft) { 
                    # Log-Message "Filtered (Left): [$txt] at Left:$($rect.Left)"
                    continue 
                }

                # Filter Input Area (Bottom 15%)
                if ($rect.Top -gt $inputAreaTop) {
                     # Log-Message "Filtered (Input Area): [$txt] at Top:$($rect.Top) > $inputAreaTop"
                     continue
                }

                # Filter "Sent" messages (Right aligned)
                # If the text starts far to the right, it's likely a message sent by me.
                if ($rect.Left -gt $receivedThresholdX) {
                    # Log-Message "Filtered (Sent/Right): [$txt] at Left:$($rect.Left) > $receivedThresholdX"
                    continue
                }

                # Add to candidates
                $candidates += [pscustomobject]@{
                    Text = $txt
                    Top = $rect.Top
                    Bottom = [double]$rect.Bottom
                }
            } catch {
                Log-Message "Error processing element: $($_.Exception.Message)"
            }
        }

        # 4. Sort by Bottom position (Descending) -> The lowest element is the latest
        if ($candidates.Count -gt 0) {
            # Use ScriptBlock for sorting to ensure numeric comparison
            $sorted = $candidates | Sort-Object -Property { $_.Bottom } -Descending
            
            # Debug: Log the bottom 5 candidates
            $top5 = $sorted | Select-Object -First 5
            foreach ($c in $top5) { Log-Message "Candidate: $($c.Text) at $($c.Bottom)" }

            return $sorted[0].Text
        } else {
             # Log-Message "No candidates found after filtering"
        }

        return $null
    } catch {
        Log-Message "Error in Get-LatestMessage-ByCoordinates: $($_.Exception.Message)"
        return $null
    }
}

Log-Message "Monitor Service Started (Coordinate Strategy - Verbose)"
Write-Output "MONITOR_STARTED"

$windowNotFoundLogged = $false

while ($true) {
    try {
        $win = Get-WeChatWindow
        if ($null -ne $win) {
            $windowNotFoundLogged = $false
            # Log-Message "Window found, scanning..."
            $msg = Get-LatestMessage-ByCoordinates $win
            
            if ($null -ne $msg -and $msg -ne $lastMessageContent) {
                $lastMessageContent = $msg
                Log-Message "Captured NEW message: $msg"
                
                # Save to JSON for external consumption (optional)
                $payload = @{
                    type = "message"
                    content = $msg
                    timestamp = (Get-Date).ToString("HH:mm:ss")
                }
                $json = ConvertTo-Json $payload -Compress
                Write-Output $json

                # Show notification (Native)
                Show-Notification "New Message" $msg
            }
        } else {
            if (-not $windowNotFoundLogged) {
                Log-Message "WeChat window NOT found. Make sure WeChat is running and the window is not minimized to tray (must be at least visible in taskbar/alt-tab)."
                $windowNotFoundLogged = $true
            }
        }
        Start-Sleep -Milliseconds 500
    } catch {
        Log-Message "Main Loop Error: $($_.Exception.Message)"
        Start-Sleep -Seconds 1
    }
}

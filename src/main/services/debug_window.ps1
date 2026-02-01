
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Write-Output "--- Process Info ---"
$procs = Get-Process -Name "WeChat" -ErrorAction SilentlyContinue
if ($procs) {
    foreach ($p in $procs) {
        Write-Output "Process: $($p.Id) - $($p.ProcessName) - MainWindowTitle: '$($p.MainWindowTitle)' - Handle: $($p.MainWindowHandle)"
    }
} else {
    Write-Output "No 'WeChat' process found."
}

Write-Output "`n--- UI Automation Root Search ---"
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "微信")
$win = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($win) {
    Write-Output "Found by Name '微信': $($win.Current.Name) - Handle: $($win.Current.NativeWindowHandle)"
} else {
    Write-Output "Not found by Name '微信'"
}

$condEn = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "WeChat")
$winEn = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condEn)
if ($winEn) {
    Write-Output "Found by Name 'WeChat': $($winEn.Current.Name) - Handle: $($winEn.Current.NativeWindowHandle)"
} else {
    Write-Output "Not found by Name 'WeChat'"
}

Write-Output "`n--- Class Name Search (WeChatMainWndForPC) ---"
$condClass = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "WeChatMainWndForPC")
$winClass = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condClass)
if ($winClass) {
    Write-Output "Found by ClassName: $($winClass.Current.Name)"
} else {
    Write-Output "Not found by ClassName"
}

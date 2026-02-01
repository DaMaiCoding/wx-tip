
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Write-Output "--- Process Info (Weixin) ---"
$procs = Get-Process -Name "Weixin" -ErrorAction SilentlyContinue
if ($procs) {
    foreach ($p in $procs) {
        Write-Output "Process: $($p.Id) - $($p.ProcessName) - MainWindowTitle: '$($p.MainWindowTitle)' - Handle: $($p.MainWindowHandle)"
        
        if ($p.MainWindowHandle -ne 0) {
            try {
                $el = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
                if ($el) {
                    Write-Output "  -> SUCCESS: Found AutomationElement via Handle. Name: '$($el.Current.Name)' Class: '$($el.Current.ClassName)'"
                } else {
                    Write-Output "  -> FAILED: Got null AutomationElement from Handle."
                }
            } catch {
                Write-Output "  -> ERROR accessing AutomationElement: $($_.Exception.Message)"
            }
        } else {
             Write-Output "  -> WARNING: MainWindowHandle is 0."
        }
    }
} else {
    Write-Output "No 'Weixin' process found."
}

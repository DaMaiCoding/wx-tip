$processes = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*monitor.ps1*" }
foreach ($p in $processes) {
    Write-Host "Killing process $($p.ProcessId) - $($p.CommandLine)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

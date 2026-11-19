Write-Output 'before-kill:'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'uxproof|node|chrome-headless' } |
  ForEach-Object { Write-Output "  $($_.ProcessId) $($_.Name)" }
Stop-Process -Name uxproof -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 8
Write-Output 'after-8s:'
$left = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'uxproof|node|chrome-headless' }
if (-not $left) { Write-Output '  none' }
else { $left | ForEach-Object { Write-Output "  $($_.ProcessId) $($_.Name) $($_.ExecutablePath)" } }
Write-Output "count=$($left.Count)"

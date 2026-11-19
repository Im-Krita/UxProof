Start-Sleep -Seconds 8
$leftover = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'uxproof|node|chrome-headless' }
if (-not $leftover) { Write-Output 'none'; exit 0 }
foreach ($p in $leftover) { Write-Output "$($p.ProcessId) $($p.Name) $($p.ExecutablePath)" }
# Clean leftovers so remaining acceptance can continue.
foreach ($p in $leftover) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$still = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'uxproof|node|chrome-headless' }
Write-Output "cleaned leftover=$($leftover.Count) still=$($still.Count)"

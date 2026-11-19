Write-Output 'before:'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'uxproof|node|chrome|chromium' } |
  ForEach-Object { Write-Output ("  $($_.ProcessId) $($_.Name) $($_.ExecutablePath)") }
Stop-Process -Name uxproof -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
Write-Output 'after:'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'uxproof|node|chrome|chromium' } |
  ForEach-Object { Write-Output ("  $($_.ProcessId) $($_.Name) $($_.ExecutablePath)") }
Write-Output 'done'

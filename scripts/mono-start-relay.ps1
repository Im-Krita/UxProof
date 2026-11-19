$ErrorActionPreference = 'Stop'
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' } | Out-Null
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\mono-serve.ps1'
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'UXProofRelay' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'UXProofRelay'
Start-Sleep -Seconds 2
try {
  $code = (Invoke-WebRequest http://127.0.0.1:4180/fixed -UseBasicParsing -TimeoutSec 5).StatusCode
  Write-Output "relay=$code"
} catch {
  Write-Output "relay-fail=$($_.Exception.Message)"
}

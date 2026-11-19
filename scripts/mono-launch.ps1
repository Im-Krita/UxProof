$ErrorActionPreference = 'Stop'
$exe = 'C:\Program Files\UXProof\uxproof.exe'
if (-not (Test-Path $exe)) { throw "missing $exe" }

Get-Process uxproof -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

$wrap = 'C:\Users\Public\uxproof-start.cmd'
@(
  '@echo off'
  'set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333'
  "start `"`" `"$exe`""
) | Set-Content -Encoding ASCII -Path $wrap

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$wrap`""
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'UXProofAccept' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'UXProofAccept'

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Get-Process uxproof -ErrorAction SilentlyContinue) { $ok = $true; break }
}
Add-Content -Path 'C:\Users\Public\uxproof-accept.log' -Value "$(Get-Date -Format o) launched=$ok pid=$((Get-Process uxproof -ErrorAction SilentlyContinue).Id)"
if (-not $ok) { throw 'uxproof did not start' }

$cdp = $false
$body = ''
for ($i = 0; $i -lt 25; $i++) {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9333/json/list' -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $cdp = $true; $body = $r.Content; break }
  } catch {}
  Start-Sleep -Seconds 1
}
Add-Content -Path 'C:\Users\Public\uxproof-accept.log' -Value "$(Get-Date -Format o) cdp=$cdp"
Write-Output "launched=$ok cdp=$cdp"
if ($body) { Write-Output $body }

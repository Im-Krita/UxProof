Get-Process uxproof -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*UXProof*' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
$d = Join-Path $env:APPDATA 'dev.uxproof.desktop\runs'
Write-Output "removing $d"
if (Test-Path $d) { Remove-Item $d -Recurse -Force }
Write-Output "exists=$(Test-Path $d)"
$z = Get-ChildItem (Join-Path $env:APPDATA 'dev.uxproof.desktop') -Recurse -Filter 'trace-*.zip' -ErrorAction SilentlyContinue
Write-Output "traceZipsBeforeDelete=$($z.Count)"

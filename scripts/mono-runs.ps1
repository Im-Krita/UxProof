$d = Join-Path $env:APPDATA 'dev.uxproof.desktop\runs'
Write-Output "runs=$d"
Write-Output "exists=$(Test-Path $d)"
if (Test-Path $d) {
  Get-ChildItem $d -Force | ForEach-Object { Write-Output ("entry=" + $_.Name + " dir=" + $_.PSIsContainer) }
  $png = Get-ChildItem $d -Recurse -Filter '*.png' -ErrorAction SilentlyContinue | Select-Object -First 5
  foreach ($f in $png) { Write-Output ("png=" + $f.FullName + " size=" + $f.Length) }
  $json = Get-ChildItem $d -Recurse -Filter 'report.json' -ErrorAction SilentlyContinue | Select-Object -First 3
  foreach ($f in $json) { Write-Output ("report=" + $f.FullName + " size=" + $f.Length) }
}
Write-Output "node=$(where.exe node 2>$null | Out-String)"
Write-Output "shortcut=$(Test-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\UXProof.lnk'))"
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'UXProof|uxproof' } | ForEach-Object { Write-Output "menu=$($_.FullName)" }
Get-ChildItem 'C:\ProgramData\Microsoft\Windows\Start Menu\Programs' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'UXProof' } | ForEach-Object { Write-Output "allusers=$($_.FullName)" }

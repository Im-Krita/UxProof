$ErrorActionPreference = 'Continue'
Write-Output "hostname=$env:COMPUTERNAME"
Write-Output "os=$([Environment]::OSVersion.VersionString)"
Write-Output "whoami=$([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
Write-Output "session=$env:SESSIONNAME"
$node = Get-Command node -ErrorAction SilentlyContinue
Write-Output "nodeCmd=$($node.Source)"
Write-Output "whereNode=$(where.exe node 2>$null)"
$wv = @()
foreach ($key in @(
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients',
  'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients'
)) {
  if (Test-Path $key) {
    Get-ChildItem $key -ErrorAction SilentlyContinue | ForEach-Object {
      $pv = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).pv
      $wv += "$($_.PSChildName)=$pv"
    }
  }
}
Write-Output "webview=$($wv -join '; ')"
Write-Output "uxproofPF=$(Test-Path 'C:\Program Files\UXProof')"
Write-Output "uxproofPF86=$(Test-Path 'C:\Program Files (x86)\UXProof')"
Get-ChildItem 'C:\Program Files' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'UXProof|uxproof' } | ForEach-Object { Write-Output "pf=$($_.FullName)" }
Write-Output "freeGB=$([math]::Round((Get-PSDrive C).Free/1GB,1))"
Write-Output "quser=$(quser.exe 2>&1 | Out-String)"
Write-Output "explorer=$(Get-Process explorer -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty SessionId)"
Write-Output "done"

$ErrorActionPreference = 'Stop'
$log = 'C:\Users\Public\uxproof-accept.log'
function Log($m) { $line = "$(Get-Date -Format o) $m"; Add-Content -Path $log -Value $line; Write-Output $line }

Log 'start'
$msi = 'C:\Users\Public\UXProof_0.1.0_x64_en-US.msi'
if (-not (Test-Path $msi)) { throw "MSI missing: $msi" }

Log 'msiexec'
$p = Start-Process -FilePath msiexec.exe -ArgumentList @('/i', $msi, '/qn', '/norestart', '/l*v', 'C:\Users\Public\uxproof-msi.log') -Wait -PassThru
Log "msiexecExit=$($p.ExitCode)"
if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 1641 -and $p.ExitCode -ne 3010) {
  throw "msiexec failed $($p.ExitCode)"
}

$exe = Get-ChildItem 'C:\Program Files','C:\Program Files (x86)','C:\Users' -Recurse -Filter 'uxproof.exe' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\src-tauri\\' } |
  Select-Object -First 1
if (-not $exe) { throw 'uxproof.exe not found after install' }
Log "exe=$($exe.FullName)"

$wv = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue
Log "webview2pv=$($wv.pv)"
Log "nodeWhere=$(where.exe node 2>$null)"
Log 'install-ok'

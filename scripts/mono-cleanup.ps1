Get-Process uxproof -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\UXProof\*' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
foreach ($name in @('UXProofAccept', 'UXProofRelay')) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
Write-Output 'cleaned'

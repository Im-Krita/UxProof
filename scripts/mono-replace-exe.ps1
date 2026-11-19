Get-Process uxproof -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
Copy-Item -Force 'C:\Users\Public\uxproof.exe' 'C:\Program Files\UXProof\uxproof.exe'
Write-Output (Get-Item 'C:\Program Files\UXProof\uxproof.exe').LastWriteTime.ToString('o')
Write-Output "size=$((Get-Item 'C:\Program Files\UXProof\uxproof.exe').Length)"

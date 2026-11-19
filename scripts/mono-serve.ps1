$html = [System.IO.File]::ReadAllBytes('C:\Users\Public\index.html')
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 4180)
$listener.Start()
Set-Content -Path 'C:\Users\Public\uxproof-relay.pid' -Value $PID
Add-Content -Path 'C:\Users\Public\uxproof-accept.log' -Value "$(Get-Date -Format o) tcp-relay pid=$PID"
$head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: text/html; charset=utf-8`r`nCache-Control: no-store`r`nContent-Length: $($html.Length)`r`nConnection: close`r`n`r`n")
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $buf = New-Object byte[] 1024
    $null = $stream.Read($buf, 0, $buf.Length)
    $stream.Write($head, 0, $head.Length)
    $stream.Write($html, 0, $html.Length)
    $stream.Flush()
  } catch {}
  try { $client.Close() } catch {}
}

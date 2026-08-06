# Run this script as Administrator to allow student devices to reach the SpeakSense server
# Right-click this file → "Run with PowerShell" (as Administrator)

Write-Host "Opening firewall ports for SpeakSense AI..." -ForegroundColor Cyan

# Remove old rules if they exist
netsh advfirewall firewall delete rule name="SpeakSense Frontend 3000" | Out-Null
netsh advfirewall firewall delete rule name="SpeakSense Backend 8000"  | Out-Null

# Add inbound rules for both ports
netsh advfirewall firewall add rule name="SpeakSense Frontend 3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="SpeakSense Backend 8000"  dir=in action=allow protocol=TCP localport=8000

Write-Host ""
Write-Host "Done! Students can now access:" -ForegroundColor Green

# Show current LAN IP
$lan = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.InterfaceAlias -notlike "*Loopback*" -and
    $_.InterfaceAlias -notlike "*Ethernet*" -and
    $_.PrefixOrigin -ne "WellKnown"
} | Sort-Object PrefixLength -Descending | Select-Object -First 1

if (-not $lan) {
    $lan = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.InterfaceAlias -notlike "*Loopback*" -and $_.PrefixOrigin -ne "WellKnown"
    } | Select-Object -First 1
}

Write-Host "  http://$($lan.IPAddress):3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

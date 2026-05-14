# Run this script as Administrator to allow the CAD backend (port 3003) through Windows Firewall.
# Right-click PowerShell > "Run as administrator", then: .\scripts\allow-backend-firewall.ps1

$ruleName = "CAD Backend (port 3003)"
$existing = netsh advfirewall firewall show rule name=$ruleName 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Firewall rule '$ruleName' already exists."
} else {
    netsh advfirewall firewall add rule name=$ruleName dir=in action=allow protocol=TCP localport=3003
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Firewall rule added. Your phone can now reach the backend at http://192.168.1.219:3003"
    } else {
        Write-Host "Failed. Make sure to run this script as Administrator."
    }
}

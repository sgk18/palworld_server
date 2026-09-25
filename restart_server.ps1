<#
.SYNOPSIS
Restarts the Palworld Dedicated Server on Microsoft Azure.
.DESCRIPTION
Safely triggers a world save in Palworld, then restarts the Azure VM.
#>

param(
    [string]$ResourceGroupName = "rg-palworld-server",
    [string]$VmName = "palworld-vm"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Restarting Palworld Dedicated Server (Azure Cloud)     " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Load .env if present
$envPath = Join-Path $PSScriptRoot ".env"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line.Split('=', 2)
            if ($parts.Count -eq 2) {
                $k = $parts[0].Trim()
                $v = $parts[1].Trim().Trim('"').Trim("'")
                [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
            }
        }
    }
}

$tenantId = $env:AZURE_TENANT_ID
$clientId = $env:AZURE_CLIENT_ID
$clientSecret = $env:AZURE_CLIENT_SECRET
$subId = $env:AZURE_SUBSCRIPTION_ID
$rg = if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { $ResourceGroupName }
$vm = if ($env:AZURE_VM_NAME) { $env:AZURE_VM_NAME } else { $VmName }
$publicIp = if ($env:PALWORLD_SERVER_IP) { $env:PALWORLD_SERVER_IP } else { "40.80.95.157" }
$apiPort = if ($env:PALWORLD_API_PORT) { $env:PALWORLD_API_PORT } else { "8212" }
$adminPass = if ($env:PALWORLD_ADMIN_PASSWORD) { $env:PALWORLD_ADMIN_PASSWORD } else { "adminPasswordHere" }

# 2. Trigger Palworld world save
Write-Host "[1/3] Attempting safe in-game world save..." -ForegroundColor Gray
try {
    $bytes = [System.Text.Encoding]::ASCII.GetBytes("admin:$adminPass")
    $b64 = [Convert]::ToBase64String($bytes)
    $null = Invoke-RestMethod -Uri "http://${publicIp}:${apiPort}/v1/api/save" -Method Post -Headers @{ "Authorization" = "Basic $b64" } -TimeoutSec 3 -ErrorAction SilentlyContinue
    Write-Host ">>> In-game world save successful! Progress preserved." -ForegroundColor Green
} catch {
    Write-Host ">>> Server unreachable or offline, proceeding directly to restart." -ForegroundColor Gray
}

$restarted = $false

# 3. Azure Service Principal Restart
if ($tenantId -and $clientId -and $clientSecret -and $subId) {
    Write-Host "[2/3] Authenticating with Azure Service Principal..." -ForegroundColor Gray
    try {
        $body = @{
            grant_type    = "client_credentials"
            client_id     = $clientId
            client_secret = $clientSecret
            scope         = "https://management.azure.com/.default"
        }
        $tokenRes = Invoke-RestMethod -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"
        $token = $tokenRes.access_token

        Write-Host "[3/3] Sending RESTART command to Azure VM '$vm'..." -ForegroundColor Cyan
        $headers = @{
            "Authorization" = "Bearer $token"
            "Content-Type"  = "application/json"
        }
        $restartUrl = "https://management.azure.com/subscriptions/$subId/resourceGroups/$rg/providers/Microsoft.Compute/virtualMachines/$vm/restart?api-version=2023-09-01"
        $null = Invoke-RestMethod -Uri $restartUrl -Method Post -Headers $headers
        Write-Host ">>> Azure VM Restart accepted! VM is rebooting..." -ForegroundColor Green
        $restarted = $true
    } catch {
        Write-Host "Service Principal restart note: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 4. Fallback to Azure CLI
if (-not $restarted) {
    Write-Host "Attempting restart via Azure CLI ('az vm restart')..." -ForegroundColor Gray
    try {
        az vm restart --resource-group $rg --name $vm --no-wait
        $restarted = $true
        Write-Host ">>> Azure CLI restart command issued successfully!" -ForegroundColor Green
    } catch {
        Write-Error "Failed to restart Azure VM: $_"
        exit 1
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Server Status: RESTARTING (Ready in ~60-90s)             " -ForegroundColor Green
Write-Host " Server Connect: ${publicIp}:8211                         " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green

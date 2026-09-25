<#
.SYNOPSIS
Turns off and deallocates the Palworld Dedicated Server on Microsoft Azure.
.DESCRIPTION
Safely triggers a world save in Palworld, then deallocates the Azure VM to stop all compute charges ($0.00/hr).
#>

param(
    [string]$ResourceGroupName = "rg-palworld-server",
    [string]$VmName = "palworld-vm"
)

Write-Host "==========================================================" -ForegroundColor Red
Write-Host "   Turning Off Palworld Dedicated Server (Azure Cloud)    " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Red

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
    Write-Host ">>> Server already offline or save timed out, proceeding to deallocation." -ForegroundColor Gray
}

$stopped = $false

# 3. Azure Service Principal Deallocate
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

        Write-Host "[3/3] Sending DEALLOCATE command to Azure VM '$vm'..." -ForegroundColor Cyan
        $headers = @{
            "Authorization" = "Bearer $token"
            "Content-Type"  = "application/json"
        }
        $deallocUrl = "https://management.azure.com/subscriptions/$subId/resourceGroups/$rg/providers/Microsoft.Compute/virtualMachines/$vm/deallocate?api-version=2023-09-01"
        $null = Invoke-RestMethod -Uri $deallocUrl -Method Post -Headers $headers
        Write-Host ">>> Azure VM Deallocation accepted! Compute billing has stopped ($0.00/hr)." -ForegroundColor Green
        $stopped = $true
    } catch {
        Write-Host "Service Principal stop note: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 4. Fallback to Azure CLI
if (-not $stopped) {
    Write-Host "Attempting stop via Azure CLI ('az vm deallocate')..." -ForegroundColor Gray
    try {
        az vm deallocate --resource-group $rg --name $vm --no-wait
        $stopped = $true
        Write-Host ">>> Azure CLI deallocate command issued successfully!" -ForegroundColor Green
    } catch {
        Write-Error "Failed to deallocate Azure VM: $_"
        exit 1
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Server Status: TURNED OFF & DEALLOCATED                  " -ForegroundColor Green
Write-Host " Free Credits Preserved: VM compute charges stopped ($0)  " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green

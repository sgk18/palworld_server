<#
.SYNOPSIS
Starts the Palworld Dedicated Server on Microsoft Azure.
.DESCRIPTION
Authenticates with Azure using the Service Principal or Azure CLI and starts the palworld-vm.
#>

param(
    [string]$ResourceGroupName = "rg-palworld-server",
    [string]$VmName = "palworld-vm"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Starting Palworld Dedicated Server (Azure Cloud)       " -ForegroundColor Green
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
$gamePort = if ($env:PALWORLD_GAME_PORT) { $env:PALWORLD_GAME_PORT } else { "8211" }

$started = $false

# 2. Try REST API with Service Principal (Zero dependency, fast)
if ($tenantId -and $clientId -and $clientSecret -and $subId) {
    Write-Host "[1/2] Authenticating with Azure Service Principal..." -ForegroundColor Gray
    try {
        $body = @{
            grant_type    = "client_credentials"
            client_id     = $clientId
            client_secret = $clientSecret
            scope         = "https://management.azure.com/.default"
        }
        $tokenRes = Invoke-RestMethod -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"
        $token = $tokenRes.access_token

        Write-Host "[2/2] Sending START command to Azure VM '$vm'..." -ForegroundColor Cyan
        $headers = @{
            "Authorization" = "Bearer $token"
            "Content-Type"  = "application/json"
        }
        $startUrl = "https://management.azure.com/subscriptions/$subId/resourceGroups/$rg/providers/Microsoft.Compute/virtualMachines/$vm/start?api-version=2023-09-01"
        $null = Invoke-RestMethod -Uri $startUrl -Method Post -Headers $headers
        Write-Host ">>> Azure VM Start accepted! Powering on compute hardware..." -ForegroundColor Green
        $started = $true
    } catch {
        Write-Host "Service Principal start note: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 3. Fallback to Azure CLI if needed
if (-not $started) {
    Write-Host "Attempting start via Azure CLI ('az vm start')..." -ForegroundColor Gray
    try {
        az vm start --resource-group $rg --name $vm --no-wait
        $started = $true
        Write-Host ">>> Azure CLI start command issued successfully!" -ForegroundColor Green
    } catch {
        Write-Error "Failed to start Azure VM: $_"
        exit 1
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Server Status: STARTING UP (Ready in ~45-60s)            " -ForegroundColor Green
Write-Host " Server Connect: ${publicIp}:${gamePort}                   " -ForegroundColor Yellow
Write-Host " Web Dashboard:  http://localhost:5050                    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green

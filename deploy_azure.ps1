<#
.SYNOPSIS
Deploys Palworld Dedicated Server Docker to Microsoft Azure.

.DESCRIPTION
This script provisions an Azure Virtual Machine, configures the required Network Security Group
rules (UDP 8211 for Palworld game traffic, UDP 27015 for Steam query traffic, TCP 22 for SSH),
configures Docker & Docker Compose, and starts the Palworld server using compose.yaml and .env.
#>

param(
    [string]$ResourceGroupName = "rg-palworld-server",
    [string]$Location = "eastus",
    [string]$VmName = "palworld-vm",
    [string]$VmSize = "Standard_D4s_v5",
    [string]$AdminUsername = "azureuser"
)

$ErrorActionPreference = "Stop"

# 1. Verify Azure CLI is installed
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    $azPath = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
    if (Test-Path $azPath) {
        $env:PATH = "$azPath;$env:PATH"
    } else {
        $azLocalPath = "$env:LOCALAPPDATA\Programs\Python\Python39\Scripts"
        if (Test-Path $azLocalPath) {
            $env:PATH = "$azLocalPath;$env:PATH"
        } else {
            Write-Error "Azure CLI ('az') is not installed or not in PATH."
            exit 1
        }
    }
}

# 2. Check Azure Account login
Write-Host "Checking Azure login status..." -ForegroundColor Cyan
try {
    $account = az account show 2>$null | ConvertFrom-Json
} catch {
    $account = $null
}

if (-not $account) {
    Write-Host "Not logged in. Starting interactive Azure login..." -ForegroundColor Yellow
    az login
    $account = az account show | ConvertFrom-Json
}

Write-Host "Connected to Azure Subscription: $($account.name) (ID: $($account.id))" -ForegroundColor Green

# 3. Create Resource Group
Write-Host "Creating Resource Group '$ResourceGroupName' in '$Location'..." -ForegroundColor Cyan
az group create --name $ResourceGroupName --location $Location -o table

# 4. Create VM with SSH key and open ports
Write-Host "Provisioning Azure VM '$VmName' (Size: $VmSize, Location: $Location)..." -ForegroundColor Cyan
$vmJson = az vm create `
    --resource-group $ResourceGroupName `
    --name $VmName `
    --image Ubuntu2204 `
    --size $VmSize `
    --admin-username $AdminUsername `
    --generate-ssh-keys `
    --public-ip-sku Standard `
    -o json

$vm = $vmJson | ConvertFrom-Json
$publicIp = $vm.publicIpAddress
Write-Host "VM created with Public IP: $publicIp" -ForegroundColor Green

# 5. Configure Network Security Group rules for Palworld
Write-Host "Configuring NSG firewall rules for Palworld UDP ports..." -ForegroundColor Cyan
$nsgName = "$($VmName)NSG"

# Open UDP 8211 (Palworld)
az network nsg rule create `
    --resource-group $ResourceGroupName `
    --nsg-name $nsgName `
    --name "AllowPalworldUDP" `
    --priority 1010 `
    --direction Inbound `
    --access Allow `
    --protocol Udp `
    --destination-port-ranges 8211 `
    -o table

# Open UDP 27015 (Steam Query)
az network nsg rule create `
    --resource-group $ResourceGroupName `
    --nsg-name $nsgName `
    --name "AllowSteamQueryUDP" `
    --priority 1020 `
    --direction Inbound `
    --access Allow `
    --protocol Udp `
    --destination-port-ranges 27015 `
    -o table

# 6. Install Docker and Docker Compose on VM
Write-Host "Installing Docker & Docker Compose on the VM..." -ForegroundColor Cyan
$setupScript = @'
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker azureuser
sudo mkdir -p /opt/palworld
sudo chown -R azureuser:azureuser /opt/palworld
'@

az vm run-command invoke `
    --resource-group $ResourceGroupName `
    --name $VmName `
    --command-id RunShellScript `
    --scripts $setupScript `
    -o table

# 7. Upload compose.yaml and .env to VM and start server
Write-Host "Deploying compose.yaml and .env to /opt/palworld/..." -ForegroundColor Cyan
$composeContent = Get-Content -Raw "c:\projects\palworld_server\compose.yaml"
$envContent = Get-Content -Raw "c:\projects\palworld_server\.env"

$composeB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($composeContent))
$envB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($envContent))

$startScript = @"
echo '$composeB64' | base64 -d | sudo tee /opt/palworld/compose.yaml > /dev/null
echo '$envB64' | base64 -d | sudo tee /opt/palworld/.env > /dev/null
cd /opt/palworld
sudo docker compose up -d
sudo docker compose ps
"@

az vm run-command invoke `
    --resource-group $ResourceGroupName `
    --name $VmName `
    --command-id RunShellScript `
    --scripts $startScript `
    -o table

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Palworld Dedicated Server Deployed Successfully on Azure!  " -ForegroundColor Green
Write-Host " Server IP: $publicIp" -ForegroundColor Yellow
Write-Host " Game Port: 8211 (UDP)" -ForegroundColor Yellow
Write-Host " Connect in Palworld: $publicIp:8211" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green

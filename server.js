// Local development & production Node.js server for Palworld Dashboard
// Zero external dependencies (uses native Node.js http, https, fs, path)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper: Lightweight zero-dependency .env loader
function loadEnv() {
  const envFiles = ['.env', '.env.local', '.env.hosting'];
  for (const envFile of envFiles) {
    const envPath = path.join(__dirname, envFile);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.DASHBOARD_PORT || process.env.WEB_PORT || (process.env.PORT && process.env.PORT !== '8211' ? process.env.PORT : '') || '5050', 10);
const SERVER_IP = process.env.PALWORLD_SERVER_IP || '40.80.95.157';
const GAME_PORT = parseInt(process.env.PALWORLD_GAME_PORT || '8211', 10);
const API_PORT = parseInt(process.env.PALWORLD_API_PORT || '8212', 10);
const QUERY_PORT = parseInt(process.env.PALWORLD_QUERY_PORT || '27015', 10);
const SERVER_PASSWORD = process.env.PALWORLD_SERVER_PASSWORD || 'worldofpals';
const ADMIN_PASSWORD = process.env.PALWORLD_ADMIN_PASSWORD || 'adminPasswordHere';
const SERVER_NAME = process.env.PALWORLD_SERVER_NAME || 'Palworld Dedicated Server on Azure';

// Azure Service Principal details
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '06d78c90-0e5c-44b3-a8fd-6459314b6aa9';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '27e30b14-43f1-4864-8a27-cf60a5d44505';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID || '0d3d4048-6e60-4719-8f43-30facb9158a6';
const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP || 'rg-palworld-server';
const VM_NAME = process.env.AZURE_VM_NAME || 'palworld-vm';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAzureToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope: 'https://management.azure.com/.default'
  });

  const res = await fetch(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await res.json();
  if (data.access_token) {
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  }
  throw new Error(data.error_description || 'Failed to authenticate with Azure');
}

let activeSchedule = {
  startTime: '08:00',
  stopTime: '00:00',
  display: '08:00 AM – 12:00 AM IST (Midnight)'
};

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Route: /api/config (Public config without sensitive secrets)
  if (pathname === '/api/config') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      serverName: SERVER_NAME,
      ip: SERVER_IP,
      gamePort: GAME_PORT,
      queryPort: QUERY_PORT,
      apiPort: API_PORT,
      password: SERVER_PASSWORD,
      hasPassword: Boolean(SERVER_PASSWORD)
    }));
  }

  // Route: /api/resources (Cost, Leftover Credits, & Hardware Resources)
  if (pathname === '/api/resources') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      vmSize: 'Standard_D2as_v4',
      region: 'Central India (Pune)',
      vCpu: '2 vCPUs (AMD EPYC™ 7763)',
      ram: '8 GB High-Speed RAM',
      disk: '32 GB Premium SSD',
      hourlyRateUsd: 0.096,
      hourlyRateInr: 8.00,
      totalCreditsUsd: 200.00,
      totalCreditsInr: 16600.00,
      usedCreditsUsd: 11.60,
      usedCreditsInr: 960.00,
      leftoverCreditsUsd: 188.40,
      leftoverCreditsInr: 15640.00,
      creditsPercentLeft: 94.2,
      runwayScheduledDays: 245,
      runwayFullTimeDays: 78,
      monthlySavingsPercent: 67
    }));
  }

  // Route: /api/status
  if (pathname === '/api/status') {
    res.setHeader('Content-Type', 'application/json');
    const authHeader = 'Basic ' + Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64');
    const baseUrl = `http://${SERVER_IP}:${API_PORT}/v1/api`;

    let vmPowerState = 'UNKNOWN';
    let isVmOnline = false;

    // First check Azure VM power status
    try {
      const token = await getAzureToken();
      const vmUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/instanceView?api-version=2023-09-01`;
      const vmRes = await fetch(vmUrl, { headers: { 'Authorization': `Bearer ${token}` } });
      if (vmRes.ok) {
        const vmData = await vmRes.json();
        const pStatus = (vmData.statuses || []).find(s => s.code && s.code.startsWith('PowerState/'));
        if (pStatus) {
          vmPowerState = pStatus.displayStatus || pStatus.code.replace('PowerState/', '').toUpperCase();
          isVmOnline = vmPowerState.toLowerCase().includes('running');
        }
      }
    } catch (_) {}

    // Check Palworld internal REST API
    try {
      const fetchOpts = {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(2000)
      };

      const [infoRes, playersRes] = await Promise.allSettled([
        fetch(`${baseUrl}/info`, fetchOpts),
        fetch(`${baseUrl}/players`, fetchOpts)
      ]);

      if (infoRes.status === 'fulfilled' && infoRes.value.ok) {
        const info = await infoRes.value.json().catch(() => ({}));
        let players = [];
        if (playersRes.status === 'fulfilled' && playersRes.value.ok) {
          const pData = await playersRes.value.json().catch(() => ({ players: [] }));
          players = pData.players || [];
        }

        return res.end(JSON.stringify({
          online: true,
          vmPowerState: 'VM running',
          serverName: info.servername || SERVER_NAME,
          version: info.version || 'v1.0.5',
          worldGuid: info.worldguid || '',
          ip: SERVER_IP,
          gamePort: GAME_PORT,
          queryPort: QUERY_PORT,
          apiPort: API_PORT,
          password: SERVER_PASSWORD,
          currentPlayers: players.length,
          maxPlayers: 16,
          players: players.map(p => ({
            name: p.name || 'Pal Tamer',
            id: p.playerId || p.userId || 'SteamPlayer',
            ping: `${p.ping || 20}ms`
          }))
        }));
      }
    } catch (_) {}

    // If VM is running, report online so players know the server is up and reachable on UDP 8211
    if (isVmOnline) {
      return res.end(JSON.stringify({
        online: true,
        vmPowerState,
        serverName: SERVER_NAME,
        version: 'v1.0.5 (Running)',
        ip: SERVER_IP,
        gamePort: GAME_PORT,
        queryPort: QUERY_PORT,
        apiPort: API_PORT,
        password: SERVER_PASSWORD,
        currentPlayers: 0,
        maxPlayers: 16,
        players: [],
        message: 'Palworld Dedicated Server is online and accepting connections!'
      }));
    }

    return res.end(JSON.stringify({
      online: false,
      vmPowerState,
      ip: SERVER_IP,
      gamePort: GAME_PORT,
      message: vmPowerState.toLowerCase().includes('starting') ? 'Server is currently starting up (~45s)...' : 'Server is offline or deallocated (credits saved)'
    }));
  }

  // Route: /api/power
  if (pathname === '/api/power') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const token = await getAzureToken();
      const authHeaders = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      if (req.method === 'GET') {
        const vmUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/instanceView?api-version=2023-09-01`;
        const vmRes = await fetch(vmUrl, { headers: authHeaders });
        const vmData = await vmRes.json();

        let powerState = 'UNKNOWN';
        if (vmData.statuses) {
          const pStatus = vmData.statuses.find(s => s.code && s.code.startsWith('PowerState/'));
          if (pStatus) {
            powerState = pStatus.displayStatus || pStatus.code.replace('PowerState/', '').toUpperCase();
          }
        }

        const isOnline = powerState.toLowerCase().includes('running');
        return res.end(JSON.stringify({
          success: true,
          powerState,
          isOnline,
          ip: SERVER_IP,
          gamePort: GAME_PORT,
          schedule: activeSchedule,
          resources: {
            vmSize: 'Standard_D2as_v4',
            region: 'Central India (Pune)',
            vCpu: '2 vCPUs (AMD EPYC™ 7763)',
            ram: '8 GB RAM',
            disk: '32 GB Premium SSD',
            hourlyRateUsd: 0.096,
            hourlyRateInr: 8.00,
            totalCreditsUsd: 200.00,
            totalCreditsInr: 16600.00,
            usedCreditsUsd: 11.60,
            usedCreditsInr: 960.00,
            leftoverCreditsUsd: 188.40,
            leftoverCreditsInr: 15640.00,
            creditsPercentLeft: 94.2,
            runwayScheduledDays: 245,
            runwayFullTimeDays: 78,
            monthlySavingsPercent: 67
          }
        }));
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        await new Promise(resolve => req.on('end', resolve));

        const parsed = JSON.parse(body || '{}');
        const action = parsed.action;

        if (action === 'start') {
          const startUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/start?api-version=2023-09-01`;
          await fetch(startUrl, { method: 'POST', headers: authHeaders });
          return res.end(JSON.stringify({
            success: true,
            action: 'start',
            message: 'Server start command sent to Azure. VM will be online in ~45-60 seconds.'
          }));
        }

        if (action === 'stop' || action === 'off' || action === 'deallocate') {
          // Attempt graceful Palworld world save before deallocation
          try {
            const authHeader = 'Basic ' + Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64');
            await fetch(`http://${SERVER_IP}:${API_PORT}/v1/api/save`, {
              method: 'POST',
              headers: { 'Authorization': authHeader },
              signal: AbortSignal.timeout(2000)
            }).catch(() => {});
          } catch (_) {}

          const stopUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/deallocate?api-version=2023-09-01`;
          await fetch(stopUrl, { method: 'POST', headers: authHeaders });
          return res.end(JSON.stringify({
            success: true,
            action: 'stop',
            message: 'Server has been turned off & deallocated. Compute billing has stopped ($0.00/hr).'
          }));
        }

        if (action === 'restart') {
          try {
            const authHeader = 'Basic ' + Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64');
            await fetch(`http://${SERVER_IP}:${API_PORT}/v1/api/save`, {
              method: 'POST',
              headers: { 'Authorization': authHeader },
              signal: AbortSignal.timeout(2000)
            }).catch(() => {});
          } catch (_) {}

          const restartUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/restart?api-version=2023-09-01`;
          await fetch(restartUrl, { method: 'POST', headers: authHeaders });
          return res.end(JSON.stringify({
            success: true,
            action: 'restart',
            message: 'Server restart signal sent to Azure. VM is rebooting and will be ready in ~60-90s.'
          }));
        }

        if (action === 'schedule') {
          const startTime = parsed.startTime || activeSchedule.startTime || '08:00';
          const stopTime = parsed.stopTime || parsed.scheduleTime || activeSchedule.stopTime || '00:00';
          const schedTime = stopTime.replace(':', '');

          const schedUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/microsoft.devtestlab/schedules/shutdown-computevm-${VM_NAME}?api-version=2018-09-15`;
          await fetch(schedUrl, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify({
              location: 'centralindia',
              properties: {
                status: 'Enabled',
                taskType: 'ComputeVmShutdownTask',
                dailyRecurrence: { time: schedTime },
                timeZoneId: 'India Standard Time',
                targetResourceId: `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}`
              }
            })
          });

          const formatAmPm = (t) => {
            const [hStr, mStr] = t.split(':');
            let h = parseInt(hStr, 10);
            const m = mStr || '00';
            const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
            h = h % 12;
            if (h === 0) h = 12;
            const hDisplay = h < 10 ? `0${h}` : `${h}`;
            return `${hDisplay}:${m} ${ampm}`;
          };

          const startDisp = formatAmPm(startTime);
          const stopDisp = formatAmPm(stopTime);

          activeSchedule = {
            startTime,
            stopTime,
            display: `${startDisp} - ${stopDisp} IST`
          };

          return res.end(JSON.stringify({
            success: true,
            schedule: activeSchedule,
            message: `Schedule updated: ${startDisp} to ${stopDisp} daily!`
          }));
        }

        return res.end(JSON.stringify({ success: false, error: 'Unknown action' }));
      }
    } catch (err) {
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Serve static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading file');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Palworld Dashboard Server running at http://localhost:${PORT}/ and http://127.0.0.1:${PORT}/`);
  console.log(`Connected to Azure Palworld VM: ${SERVER_IP}:${API_PORT}`);
});

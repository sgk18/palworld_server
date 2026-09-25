// Vercel Serverless Function: Real Live Palworld Status API
// Proxies live data from the Azure VM Palworld REST API

const SERVER_IP = process.env.PALWORLD_SERVER_IP || '40.80.95.157';
const API_PORT = process.env.PALWORLD_API_PORT || '8212';
const ADMIN_PASSWORD = process.env.PALWORLD_ADMIN_PASSWORD || 'adminPasswordHere';

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '06d78c90-0e5c-44b3-a8fd-6459314b6aa9';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '27e30b14-43f1-4864-8a27-cf60a5d44505';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID || '0d3d4048-6e60-4719-8f43-30facb9158a6';
const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP || 'rg-palworld-server';
const VM_NAME = process.env.AZURE_VM_NAME || 'palworld-vm';
const SERVER_NAME = process.env.PALWORLD_SERVER_NAME || 'Palworld Dedicated Server on Azure';
const SERVER_PASSWORD = process.env.PALWORLD_SERVER_PASSWORD || 'worldofpals';

async function getAzureToken() {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: AZURE_CLIENT_ID,
      client_secret: AZURE_CLIENT_SECRET,
      scope: 'https://management.azure.com/.default'
    })
  });
  if (!tokenRes.ok) return null;
  const data = await tokenRes.json();
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const targetIp = req.query.ip || SERVER_IP;
  const targetPort = req.query.port || API_PORT;
  const targetPassword = req.query.password || ADMIN_PASSWORD;

  const authHeader = 'Basic ' + Buffer.from(`admin:${targetPassword}`).toString('base64');
  const baseUrl = `http://${targetIp}:${targetPort}/v1/api`;

  let isVmOnline = false;
  let vmPowerState = 'UNKNOWN';

  // Check Azure VM state
  try {
    const token = await getAzureToken();
    if (token) {
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
    }
  } catch (_) {}

  try {
    const fetchOptions = {
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(2000)
    };

    // Query real Palworld REST API
    const [infoRes, playersRes] = await Promise.allSettled([
      fetch(`${baseUrl}/info`, fetchOptions),
      fetch(`${baseUrl}/players`, fetchOptions)
    ]);

    if (infoRes.status === 'fulfilled' && infoRes.value.ok) {
      const infoData = await infoRes.value.json().catch(() => ({}));
      let players = [];
      if (playersRes.status === 'fulfilled' && playersRes.value.ok) {
        const pData = await playersRes.value.json().catch(() => ({ players: [] }));
        players = pData.players || [];
      }

      return res.status(200).json({
        online: true,
        vmPowerState: 'VM running',
        serverName: infoData.servername || SERVER_NAME,
        version: infoData.version || 'v1.0.5',
        worldGuid: infoData.worldguid || '',
        ip: targetIp,
        gamePort: 8211,
        queryPort: 27015,
        apiPort: 8212,
        password: SERVER_PASSWORD,
        currentPlayers: players.length,
        maxPlayers: 16,
        players: players.map(p => ({
          name: p.name || 'Tamer',
          id: p.playerId || p.userId || 'SteamPlayer',
          ping: `${p.ping || 20}ms`
        }))
      });
    }

    if (isVmOnline) {
      return res.status(200).json({
        online: true,
        vmPowerState,
        serverName: SERVER_NAME,
        version: 'v1.0.5 (Running)',
        ip: targetIp,
        gamePort: 8211,
        queryPort: 27015,
        apiPort: 8212,
        password: SERVER_PASSWORD,
        currentPlayers: 0,
        maxPlayers: 16,
        players: [],
        message: 'Palworld Dedicated Server is online and accepting connections!'
      });
    }

    return res.status(200).json({
      online: false,
      vmPowerState,
      ip: targetIp,
      gamePort: 8211,
      message: vmPowerState.toLowerCase().includes('starting') ? 'Server is currently starting up (~45s)...' : 'Server is offline or deallocated (credits preserved).'
    });

  } catch (err) {
    if (isVmOnline) {
      return res.status(200).json({
        online: true,
        vmPowerState,
        serverName: SERVER_NAME,
        version: 'v1.0.5 (Running)',
        ip: targetIp,
        gamePort: 8211,
        queryPort: 27015,
        apiPort: 8212,
        password: SERVER_PASSWORD,
        currentPlayers: 0,
        maxPlayers: 16,
        players: [],
        message: 'Palworld Dedicated Server is online and accepting connections!'
      });
    }

    return res.status(200).json({
      online: false,
      vmPowerState,
      ip: targetIp,
      gamePort: 8211,
      error: err.message
    });
  }
}

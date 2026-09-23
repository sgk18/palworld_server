// Vercel Serverless Function: Proxy & Aggregator for Palworld Server REST API
// Deployed automatically when hosting on Vercel

export default async function handler(req, res) {
  // Set CORS headers so any frontend can query this endpoint
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const serverIp = req.query.ip || process.env.PALWORLD_SERVER_IP;
  const apiPort = req.query.port || process.env.PALWORLD_API_PORT || '8212';
  const adminPassword = req.query.password || process.env.PALWORLD_ADMIN_PASSWORD || 'PalworldAdmin2026!';

  if (!serverIp) {
    return res.status(400).json({
      error: 'Missing server IP parameter (?ip=X.X.X.X)'
    });
  }

  const baseUrl = `http://${serverIp}:${apiPort}/v1/api`;
  const authHeader = 'Basic ' + Buffer.from(`admin:${adminPassword}`).toString('base64');

  try {
    const fetchOptions = {
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(3500)
    };

    // Parallel requests to Palworld REST endpoints
    const [infoRes, metricsRes, playersRes] = await Promise.allSettled([
      fetch(`${baseUrl}/info`, fetchOptions),
      fetch(`${baseUrl}/metrics`, fetchOptions),
      fetch(`${baseUrl}/players`, fetchOptions)
    ]);

    let isOnline = false;
    let serverInfo = {};
    let metrics = {};
    let players = [];

    if (infoRes.status === 'fulfilled' && infoRes.value.ok) {
      isOnline = true;
      serverInfo = await infoRes.value.json().catch(() => ({}));
    }

    if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
      metrics = await metricsRes.value.json().catch(() => ({}));
    }

    if (playersRes.status === 'fulfilled' && playersRes.value.ok) {
      const playerData = await playersRes.value.json().catch(() => ({ players: [] }));
      players = playerData.players || [];
    }

    if (!isOnline && metricsRes.status !== 'fulfilled' && playersRes.status !== 'fulfilled') {
      return res.status(200).json({
        online: false,
        message: 'Server unreachable or offline'
      });
    }

    return res.status(200).json({
      online: true,
      serverName: serverInfo.servername || 'Palworld Server',
      version: serverInfo.version || 'v0.4.x',
      currentPlayers: metrics.currentplayernum ?? players.length ?? 0,
      maxPlayers: metrics.maxplayernum ?? 16,
      fps: metrics.serverfps ?? 60.0,
      uptime: metrics.uptime ?? 0,
      players: players.map(p => ({
        name: p.name || 'Tamer',
        id: p.playerId || p.userId || 'SteamUser',
        ping: `${p.ping || 30}ms`
      }))
    });

  } catch (error) {
    return res.status(200).json({
      online: false,
      error: error.message
    });
  }
}

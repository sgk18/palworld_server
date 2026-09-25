// Vercel Serverless Function: Public Server Configuration
// Safely exposes connection parameters to the client without exposing private secrets.

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const serverName = process.env.PALWORLD_SERVER_NAME || 'Palworld Dedicated Server on Azure';
  const ip = process.env.PALWORLD_SERVER_IP || '40.80.95.157';
  const gamePort = parseInt(process.env.PALWORLD_GAME_PORT || '8211', 10);
  const queryPort = parseInt(process.env.PALWORLD_QUERY_PORT || '27015', 10);
  const apiPort = parseInt(process.env.PALWORLD_API_PORT || '8212', 10);
  const password = process.env.PALWORLD_SERVER_PASSWORD || 'worldofpals';

  return res.status(200).json({
    serverName,
    ip,
    gamePort,
    queryPort,
    apiPort,
    password,
    hasPassword: Boolean(password)
  });
}

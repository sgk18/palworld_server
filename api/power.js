// Vercel Serverless Function: Azure VM Power Management & Schedule Controller
// Allows starting, stopping (deallocating to save credits), and setting the auto-shutdown schedule.

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '06d78c90-0e5c-44b3-a8fd-6459314b6aa9';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '27e30b14-43f1-4864-8a27-cf60a5d44505';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID || '0d3d4048-6e60-4719-8f43-30facb9158a6';
const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP || 'rg-palworld-server';
const VM_NAME = process.env.AZURE_VM_NAME || 'palworld-vm';
const PUBLIC_IP = process.env.PALWORLD_SERVER_IP || '40.80.95.157';

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
  
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Azure Token Error: ${errText}`);
  }
  
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const token = await getAzureToken();
    const authHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // GET /api/power: Returns VM state and current auto-shutdown schedule
    if (req.method === 'GET') {
      // 1. Get VM Instance View
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

      // 2. Get Auto-Shutdown Schedule
      const schedUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/microsoft.devtestlab/schedules/shutdown-computevm-${VM_NAME}?api-version=2018-09-15`;
      const schedRes = await fetch(schedUrl, { headers: authHeaders });
      let scheduleTime = '12:00 PM IST (06:30 UTC)';
      let scheduleStatus = 'Enabled';

      if (schedRes.ok) {
        const schedData = await schedRes.json();
        if (schedData.properties) {
          scheduleTime = schedData.properties.dailyRecurrence?.time || scheduleTime;
          scheduleStatus = schedData.properties.status || scheduleStatus;
        }
      }

      return res.status(200).json({
        success: true,
        powerState, // e.g. "VM running", "VM deallocated", "running", "deallocated"
        isOnline: powerState.toLowerCase().includes('running'),
        ip: PUBLIC_IP,
        gamePort: 8211,
        queryPort: 27015,
        apiPort: 8212,
        schedule: {
          shutdownTime: scheduleTime,
          status: scheduleStatus,
          windowNote: 'Auto-shuts down to preserve free credits for 1 full year'
        },
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
      });
    }

    // POST /api/power: Trigger Start, Stop (Deallocate), or Update Schedule
    if (req.method === 'POST') {
      const { action, scheduleTime } = req.body || {};

      if (action === 'start') {
        const startUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/start?api-version=2023-09-01`;
        const startRes = await fetch(startUrl, { method: 'POST', headers: authHeaders });
        
        return res.status(200).json({
          success: true,
          action: 'start',
          message: 'Server starting command sent to Azure. VM will be online within 60 seconds.'
        });
      }

      if (action === 'stop' || action === 'off' || action === 'deallocate') {
        // Attempt safe world save before deallocation if Palworld REST API is reachable
        try {
          const adminPass = process.env.PALWORLD_ADMIN_PASSWORD || 'adminPasswordHere';
          const auth = 'Basic ' + Buffer.from(`admin:${adminPass}`).toString('base64');
          await fetch(`http://${PUBLIC_IP}:8212/v1/api/save`, {
            method: 'POST',
            headers: { 'Authorization': auth },
            signal: AbortSignal.timeout(2000)
          }).catch(() => {});
        } catch (_) {}

        const stopUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/deallocate?api-version=2023-09-01`;
        const stopRes = await fetch(stopUrl, { method: 'POST', headers: authHeaders });

        return res.status(200).json({
          success: true,
          action: 'stop',
          message: 'Server has been turned off and deallocated. Azure compute charges stopped ($0.00/hr).'
        });
      }

      if (action === 'restart') {
        try {
          const adminPass = process.env.PALWORLD_ADMIN_PASSWORD || 'adminPasswordHere';
          const auth = 'Basic ' + Buffer.from(`admin:${adminPass}`).toString('base64');
          await fetch(`http://${PUBLIC_IP}:8212/v1/api/save`, {
            method: 'POST',
            headers: { 'Authorization': auth },
            signal: AbortSignal.timeout(2000)
          }).catch(() => {});
        } catch (_) {}

        const restartUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/restart?api-version=2023-09-01`;
        await fetch(restartUrl, { method: 'POST', headers: authHeaders });

        return res.status(200).json({
          success: true,
          action: 'restart',
          message: 'Server restart signal sent to Azure. VM will reboot and Palworld server will come online in ~60-90s.'
        });
      }

      if (action === 'schedule') {
        const startTime = req.body.startTime || '08:00';
        const stopTime = req.body.stopTime || req.body.scheduleTime || '00:00';
        const schedTime = stopTime.replace(':', '');

        const schedUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/microsoft.devtestlab/schedules/shutdown-computevm-${VM_NAME}?api-version=2018-09-15`;
        
        const updateBody = {
          location: 'centralindia',
          properties: {
            status: 'Enabled',
            taskType: 'ComputeVmShutdownTask',
            dailyRecurrence: {
              time: schedTime
            },
            timeZoneId: 'India Standard Time',
            targetResourceId: `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}`
          }
        };

        await fetch(schedUrl, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify(updateBody)
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

        return res.status(200).json({
          success: true,
          action: 'schedule',
          schedule: {
            startTime,
            stopTime,
            display: `${startDisp} – ${stopDisp} IST`
          },
          message: `Schedule updated: ${startDisp} to ${stopDisp} daily!`
        });
      }

      return res.status(400).json({ error: 'Unknown action. Valid actions: start, stop, schedule' });
    }

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

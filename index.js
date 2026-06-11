require('dotenv').config();

const mineflayer = require('mineflayer');
const createClient = require('minecraft-protocol').createClient;
const { Authflow } = require('prismarine-auth');
const { RealmAPI } = require('prismarine-realms');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Change this placeholder to your actual Microsoft profile email address
const BOT_EMAIL = process.env.BOT_EMAIL;

const IP_CACHE_FILE = path.join(__dirname, 'last_ip.txt');
const HAPROXY_CONFIG = '/etc/haproxy/haproxy.cfg';
const MSA_CACHE_DIR = path.join(__dirname, 'msa_cache');

function getLastIP() {
  if (fs.existsSync(IP_CACHE_FILE)) {
    return fs.readFileSync(IP_CACHE_FILE, 'utf8').trim();
  }
  return null;
}

function saveCurrentIP(ip) {
  fs.writeFileSync(IP_CACHE_FILE, ip, 'utf8');
}

function reloadHAProxy(newHost, newPort) {
  try {
    console.log(`[HAProxy] Updating backend target configuration -> ${newHost}:${newPort}`);

    const configTemplate = `global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    user haproxy
    group haproxy
    daemon
    stats socket /run/haproxy/admin.sock mode 660 level admin expose-fd listeners
    stats timeout 30s
defaults
    log     global
    mode    tcp
    option  tcplog
    option  dontlognull
    timeout connect 5s
    timeout client  24h
    timeout server  24h
    timeout tunnel  24h
frontend minecraft_front
    bind 0.0.0.0:25565
    mode tcp
    option clitcpka
    default_backend minecraft_back
backend minecraft_back
    mode tcp
    balance roundrobin
    option srvtcpka
    server dynamic_realm ${newHost}:${newPort} check sni str(${newHost})
`;

    // FIX 1: Write to a temporary file in your local directory first to prevent EACCES errors
    const tempPath = path.join(__dirname, 'haproxy.tmp');
    fs.writeFileSync(tempPath, configTemplate, 'utf8');

    // Use sudo via shell execution to securely copy the configuration over to the system folder
    execSync(`sudo mv ${tempPath} ${HAPROXY_CONFIG}`);
    execSync('sudo systemctl reload haproxy');
    console.log('[HAProxy] Configuration reloaded seamlessly.');
  } catch (error) {
    console.error('[HAProxy] Failed to apply configurations:', error.message);
  }
}

async function fetchRealmAddressWithRetry(api, maxRetries = 10, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Fetching active Minecraft Realm endpoints (Attempt ${attempt}/${maxRetries})...`);
      const realmsList = await api.getRealms();
      if (!realmsList || realmsList.length === 0) {
        console.error('No available Realms discovered on this profile.');
        process.exit(1);
      }
      const activeRealm = realmsList[0];
      const connectionAddress = await activeRealm.getAddress();
      return connectionAddress;
    } catch (err) {
      if (err.message.includes('503') || err.message.includes('Service Unavailable')) {
        console.warn(`[Mojang API] Realm is waking up (503). Retrying in ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        console.error('Fatal API Error occurred:', err.message);
        process.exit(1);
      }
    }
  }
  process.exit(1);
}

async function startWorkflow() {
  console.log('Initializing pre-authentication process...');
  const authflow = new Authflow(BOT_EMAIL, MSA_CACHE_DIR);
  const xboxToken = await authflow.getMinecraftJavaToken().catch(err => {
    console.error('Authentication Flow Failed. Run manually to link account.', err.message);
    process.exit(1);
  });
  const api = RealmAPI.from(authflow, 'java');
  const connectionAddress = await fetchRealmAddressWithRetry(api);
  const remoteHost = connectionAddress.host;
  const targetPort = connectionAddress.port || 25565;
  const currentFullIP = `${remoteHost}:${targetPort}`;
  const lastIP = getLastIP();
  console.log(`Previous Cached IP: ${lastIP || 'None'} | Current Active Route: ${currentFullIP}`);
  if (lastIP !== currentFullIP) {
    reloadHAProxy(remoteHost, targetPort);
    saveCurrentIP(currentFullIP);
    console.log('Waiting 3s for HAProxy worker pipeline to settle...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  } else {
    console.log('[HAProxy] Target matches cache record. Skipping hardware reload.');
  }
  launchBot(remoteHost, targetPort, xboxToken);
}

function launchBot(remoteHost, targetPort, xboxToken) {
  console.log('Bridging pre-authenticated connection through proxy...');
  const profileName = (xboxToken.profile && xboxToken.profile.name) ? xboxToken.profile.name : 'Bot';

  const client = createClient({
    host: '127.0.0.1',
    port: 25565,

    // FIX 2: Setting version to false disables the hardcoded check, forcing the protocol layer
    // to dynamically negotiate the correct versions directly with the active backend
    version: false,

    username: profileName,
    session: xboxToken.session,
    auth: 'none',
    profilesFolder: MSA_CACHE_DIR,
    skipValidation: true,
    fakeHost: remoteHost
  });

  const bot = mineflayer.createBot({ client: client });

  bot.on('spawn', () => {
    console.log('Success! Bot bypassed local handshake loops and joined the Realm via HAProxy.');
  });

  bot.on('error', (err) => {
    console.error('Mineflayer Error Context:', err.message);
  });

  bot.on('end', () => {
    console.log('Bot disconnected. Rebooting instance loop in 10 seconds...');
    setTimeout(() => {
      process.exit(0);
    }, 10000);
  });
}

startWorkflow();

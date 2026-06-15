'use strict'

installTimestampedConsole()

const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const readline = require('node:readline')
const { execFileSync } = require('node:child_process')
const mc = require('minecraft-protocol')
const createProtocol775Packets = require('./src/protocol-775')

const PROTOCOL_VERSION = 775
// minecraft-protocol has not published a named 26.1.2 codec yet. Protocol 774
// is the closest packet schema; the handshake below is always overridden to 775.
const CODEC_VERSION = '1.21.11'
const AUTH_FOLDER = path.join(process.cwd(), 'msa_cache')
const LAST_LOGIN_FILE = path.join(AUTH_FOLDER, 'last-login.json')
const MINECRAFT_DATA = require('minecraft-data')(CODEC_VERSION)
const CUSTOM_PACKETS = createProtocol775Packets(MINECRAFT_DATA)
const IP_CACHE_FILE = path.join(process.cwd(), 'last_ip.txt')
const HOSTILE_ENTITY_IDS = new Set(
  MINECRAFT_DATA.entitiesArray.filter(entity => entity.type === 'hostile').map(entity => entity.id)
)
const FOOD_BY_ITEM_ID = new Map(MINECRAFT_DATA.foodsArray.map(food => [food.id, food]))
const ATTACK_RANGE_SQUARED = 3 * 3
const EAT_RETRY_DELAY_MS = 2000
const OFFHAND_SLOT = 45

loadEnvFile(path.join(process.cwd(), '.env'))
const lastLogin = loadJsonFile(LAST_LOGIN_FILE)

const username = process.env.BOT_EMAIL
const realmId = process.env.REALM_ID
const realmName = process.env.REALM_NAME
const proxyHost = process.env.PROXY_HOST || '127.0.0.1'
const proxyPort = parseInteger(process.env.PROXY_PORT, 25565, 'PROXY_PORT', 65535)
const haproxyConfig = process.env.HAPROXY_CONFIG || '/etc/haproxy/haproxy.cfg'
const reconnectDelay = parseInteger(
  process.env.RECONNECT_DELAY_MS,
  5000,
  'RECONNECT_DELAY_MS',
  Number.MAX_SAFE_INTEGER
)
const autoSleepEnabled = parseBoolean(process.env.AUTO_SLEEP_ENABLED, false, 'AUTO_SLEEP_ENABLED')
const sleepClickInterval = parseInteger(
  process.env.SLEEP_CLICK_INTERVAL_MS,
  1000,
  'SLEEP_CLICK_INTERVAL_MS',
  Number.MAX_SAFE_INTEGER
)
const autoRespawnEnabled = parseBoolean(
  process.env.AUTO_RESPAWN_ENABLED,
  false,
  'AUTO_RESPAWN_ENABLED'
)
const autoAttackEnabled = parseBoolean(
  process.env.AUTO_ATTACK_ENABLED,
  false,
  'AUTO_ATTACK_ENABLED'
)
const attackInterval = parseInteger(
  process.env.ATTACK_INTERVAL_MS,
  1000,
  'ATTACK_INTERVAL_MS',
  Number.MAX_SAFE_INTEGER
)
const autoEatOffhandEnabled = parseBoolean(
  process.env.AUTO_EAT_OFFHAND_ENABLED,
  false,
  'AUTO_EAT_OFFHAND_ENABLED'
)
const respawnDelay = parseInteger(
  process.env.RESPAWN_DELAY_MS,
  500,
  'RESPAWN_DELAY_MS',
  Number.MAX_SAFE_INTEGER
)
const FAILURE_EXIT_TIMEOUT_MS = 2000

if (!username) {
  console.error('BOT_EMAIL is required. Set it in .env.')
  process.exit(1)
}

let client
let reconnectTimer
let shuttingDown = false
let position
let connectedAt
let reconnectAttempts = 0
let sentPlayerLoaded = false
let selectedRealm
let configuredTarget
let exitAfterDisconnect = false
let failureExitTimer
let sleepClickTimer
let respawnTimer
let attackTimer
let eatRetryTimer
let awaitingRespawn = false
let foodLevel
let offhandFood
let isAutoEating = false
let interactionSequence = 0
const hostileEntities = new Map()

function installTimestampedConsole() {
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method].bind(console)
    console[method] = (...args) => original(`[${formatTimestamp(new Date())}]`, ...args)
  }
}

function formatTimestamp(date) {
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60)
  const offsetRemainder = Math.abs(offsetMinutes) % 60

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
      `${String(date.getMilliseconds()).padStart(3, '0')}`,
    `${offsetSign}${pad(offsetHours)}:${pad(offsetRemainder)}`
  ].join(' ')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function connect() {
  console.log('Resolving Java Realm endpoint and preparing HAProxy...')
  createProtocolClient()
}

function createProtocolClient() {
  sentPlayerLoaded = false
  position = undefined
  stopSleepClicks()
  stopAutoAttack()
  stopAutoEat()
  clearTimeout(respawnTimer)
  respawnTimer = undefined
  awaitingRespawn = false
  foodLevel = undefined
  offhandFood = undefined
  interactionSequence = 0
  hostileEntities.clear()

  const options = {
    username,
    auth: 'microsoft',
    realms: {
      pickRealm: chooseRealm
    },
    version: CODEC_VERSION,
    customPackets: CUSTOM_PACKETS,
    hideErrors: true,
    profilesFolder: AUTH_FOLDER,
    connect(protocolClient) {
      // createClient derives 774 from CODEC_VERSION. Override it immediately
      // before setProtocol writes the handshake packet.
      options.protocolVersion = PROTOCOL_VERSION
      ensureHAProxyTarget(options.host, options.port)
      console.log(
        `Connecting bot to Realm "${selectedRealm.name}" through ` +
        `${proxyHost}:${proxyPort}...`
      )
      protocolClient.setSocket(net.connect(proxyPort, proxyHost))
    },
    onMsaCode: printMicrosoftCode
  }

  const currentClient = mc.createClient(options)
  client = currentClient

  currentClient.on('session', (session) => {
    console.log(`Authenticated as ${session.selectedProfile.name}`)
    saveLastLogin({
      profile: {
        id: session.selectedProfile.id,
        name: session.selectedProfile.name
      }
    })
  })

  currentClient.on('playerJoin', () => {
    connectedAt = Date.now()
    console.log(
      `Joined Realm "${selectedRealm.name}" ` +
      `using official protocol ${PROTOCOL_VERSION}`
    )
    currentClient.write('settings', {
      locale: 'en_us',
      viewDistance: 8,
      chatFlags: 0,
      chatColors: true,
      skinParts: 0x7f,
      mainHand: 1,
      enableTextFiltering: false,
      enableServerListing: true,
      particleStatus: 'minimal'
    })
    saveLastLogin({
      lastJoinedAt: new Date().toISOString(),
      target: {
        type: 'realm',
        id: selectedRealm.id,
        name: selectedRealm.name,
        host: options.host,
        port: options.port
      }
    })
  })

  currentClient.on('position', (packet) => {
    position = updatePosition(position, packet)
    awaitingRespawn = false
    currentClient.write('teleport_confirm', { teleportId: packet.teleportId })
    if (!sentPlayerLoaded) {
      sentPlayerLoaded = true
      currentClient.writeRaw(Buffer.from([0x2c]))
    }
    tryAutoEat(currentClient)
    if (!isAutoEating) {
      tryAutoSleep(currentClient)
      tryAutoAttack(currentClient)
    }
  })

  currentClient.on('update_health', (packet) => {
    foodLevel = packet.food
    if (shouldAutoEat()) {
      tryAutoEat(currentClient)
      return
    }

    finishAutoEating(currentClient)
  })

  currentClient.on('window_items', (packet) => {
    if (packet.windowId !== 0) return
    updateOffhandFood(packet.items[OFFHAND_SLOT])
    if (shouldAutoEat()) tryAutoEat(currentClient)
  })

  currentClient.on('set_slot', (packet) => {
    if (packet.windowId !== 0 || packet.slot !== OFFHAND_SLOT) return
    updateOffhandFood(packet.item)
    if (shouldAutoEat()) tryAutoEat(currentClient)
    else finishAutoEating(currentClient)
  })

  currentClient.on('spawn_entity', (packet) => {
    if (!HOSTILE_ENTITY_IDS.has(packet.type)) return
    hostileEntities.set(packet.entityId, { x: packet.x, y: packet.y, z: packet.z })
  })

  currentClient.on('rel_entity_move', updateTrackedEntity)
  currentClient.on('entity_move_look', updateTrackedEntity)

  currentClient.on('entity_teleport', (packet) => {
    const entity = hostileEntities.get(packet.entityId)
    if (!entity) return
    Object.assign(entity, { x: packet.x, y: packet.y, z: packet.z })
  })

  currentClient.on('sync_entity_position', (packet) => {
    const entity = hostileEntities.get(packet.entityId)
    if (!entity) return
    Object.assign(entity, { x: packet.x, y: packet.y, z: packet.z })
  })

  currentClient.on('entity_destroy', (packet) => {
    for (const entityId of packet.entityIds) hostileEntities.delete(entityId)
  })

  currentClient.on('death_combat_event', (packet) => {
    if (awaitingRespawn) return

    awaitingRespawn = true
    position = undefined
    stopSleepClicks()
    stopAutoAttack()
    stopAutoEat()
    console.log(`Player died: ${formatComponent(packet.message)}.`)
    if (!autoRespawnEnabled) return

    console.log(`Requesting respawn in ${respawnDelay}ms...`)
    respawnTimer = setTimeout(() => {
      respawnTimer = undefined
      if (client !== currentClient || currentClient.ended) return
      currentClient.write('client_command', { actionId: 0 })
      console.log('Sent automatic respawn request.')
    }, respawnDelay)
  })

  currentClient.on('protocol_775_chunk_batch_finished', () => {
    currentClient.write('chunk_batch_received', { chunksPerTick: 10 })
  })

  currentClient.on('playerChat', (packet) => {
    console.log(`<player> ${packet.plainMessage || formatComponent(packet.formattedMessage)}`)
  })

  currentClient.on('systemChat', (packet) => {
    console.log(formatComponent(packet.formattedMessage))
  })

  currentClient.on('disconnect', (packet) => {
    const reason = formatComponent(packet.reason)
    console.error('Login/configuration disconnect:', reason)
    stopAfterFailure(currentClient, `server disconnect: ${reason}`)
  })

  currentClient.on('kick_disconnect', (packet) => {
    const reason = formatComponent(packet.reason)
    console.error('Kicked:', reason)
    stopAfterFailure(currentClient, `kicked: ${reason}`)
  })

  currentClient.on('error', (error) => {
    console.error('Protocol error:', error.message)
    stopAfterFailure(currentClient, `error: ${error.message}`)
  })

  currentClient.once('end', (reason) => {
    if (client !== currentClient) return

    const connectedFor = connectedAt ? Date.now() - connectedAt : 0
    console.log(
      `Disconnected after ${Math.round(connectedFor / 1000)}s: ` +
      `${reason || 'connection ended'}`
    )
    if (connectedFor >= 120000) reconnectAttempts = 0
    connectedAt = undefined
    client = undefined
    stopSleepClicks()
    stopAutoAttack()
    stopAutoEat()
    hostileEntities.clear()
    clearTimeout(respawnTimer)
    respawnTimer = undefined
    if (exitAfterDisconnect) {
      clearTimeout(failureExitTimer)
      console.log('Exiting process after connection failure.')
      process.exit(1)
    }
    if (!shuttingDown) scheduleReconnect()
  })
}

function chooseRealm(realms) {
  if (!realms.length) {
    throw new Error('No Java Realms are available to this Microsoft account.')
  }

  let realm

  if (realmId) {
    realm = realms.find(candidate => String(candidate.id) === realmId)
  } else if (realmName) {
    realm = realms.find(candidate => candidate.name === realmName)
  } else {
    realm = realms.find(candidate => candidate.state === 'OPEN') || realms[0]
  }

  if (!realm) {
    const selector = realmId
      ? `ID ${realmId}`
      : `name "${realmName}"`
    throw new Error(`Could not find a Java Realm with ${selector}.`)
  }

  selectedRealm = realm
  console.log(`Selected Realm "${realm.name}" (${realm.id}).`)
  return realm
}

function tryAutoSleep(currentClient) {
  if (
    !autoSleepEnabled ||
    isAutoEating ||
    client !== currentClient ||
    !position
  ) {
    stopSleepClicks()
    return
  }

  if (sleepClickTimer) return

  rightClickUnderfoot(currentClient)
  sleepClickTimer = setInterval(() => {
    if (
      client !== currentClient ||
      !position
    ) {
      stopSleepClicks()
      return
    }
    rightClickUnderfoot(currentClient)
  }, sleepClickInterval)
}

function rightClickUnderfoot(currentClient) {
  const bedPosition = {
    x: Math.floor(position.x),
    y: Math.floor(position.y - 0.01),
    z: Math.floor(position.z)
  }

  currentClient.write('look', {
    yaw: position.yaw || 0,
    pitch: 90,
    flags: {
      onGround: true,
      hasHorizontalCollision: false
    }
  })
  currentClient.write('block_place', {
    hand: 0,
    location: bedPosition,
    direction: 1,
    cursorX: 0.5,
    cursorY: 1,
    cursorZ: 0.5,
    insideBlock: false,
    worldBorderHit: false,
    sequence: interactionSequence++
  })
  console.log(
    `Looked down and right-clicked underfoot at ` +
    `${bedPosition.x},${bedPosition.y},${bedPosition.z}.`
  )
}

function stopSleepClicks() {
  clearInterval(sleepClickTimer)
  sleepClickTimer = undefined
}

function tryAutoAttack(currentClient) {
  if (!autoAttackEnabled || isAutoEating || client !== currentClient || !position) {
    stopAutoAttack()
    return
  }
  if (attackTimer) return

  attackNearestHostile(currentClient)
  attackTimer = setInterval(() => attackNearestHostile(currentClient), attackInterval)
}

function attackNearestHostile(currentClient) {
  if (client !== currentClient || !position || awaitingRespawn) {
    stopAutoAttack()
    return
  }

  let nearestId
  let nearestDistance = ATTACK_RANGE_SQUARED
  for (const [entityId, entity] of hostileEntities) {
    const distance =
      (entity.x - position.x) ** 2 +
      (entity.y - position.y) ** 2 +
      (entity.z - position.z) ** 2
    if (distance > nearestDistance) continue
    nearestId = entityId
    nearestDistance = distance
  }
  if (nearestId === undefined) return

  currentClient.write('attack', { target: nearestId })
  currentClient.write('arm_animation', { hand: 0 })
  console.log(`Attacked nearby hostile entity ${nearestId}.`)
}

function stopAutoAttack() {
  clearInterval(attackTimer)
  attackTimer = undefined
}

function tryAutoEat(currentClient) {
  if (
    !autoEatOffhandEnabled ||
    client !== currentClient ||
    !position ||
    awaitingRespawn ||
    foodLevel === undefined ||
    !shouldAutoEat()
  ) {
    if (!shouldAutoEat() || client !== currentClient || awaitingRespawn) stopAutoEat()
    return
  }
  if (eatRetryTimer) return

  if (!isAutoEating) {
    console.log(
      `Food level is ${foodLevel}; eating ${offhandFood.displayName} from offhand ` +
      `to restore ${offhandFood.foodPoints} hunger points.`
    )
  }
  isAutoEating = true
  stopSleepClicks()
  stopAutoAttack()
  currentClient.write('use_item', {
    hand: 1,
    sequence: interactionSequence++,
    rotation: {
      x: position.yaw || 0,
      y: position.pitch || 0
    }
  })
  eatRetryTimer = setTimeout(() => {
    eatRetryTimer = undefined
    tryAutoEat(currentClient)
  }, EAT_RETRY_DELAY_MS)
}

function stopAutoEat() {
  clearTimeout(eatRetryTimer)
  eatRetryTimer = undefined
  isAutoEating = false
}

function shouldAutoEat() {
  return Boolean(
    autoEatOffhandEnabled &&
    offhandFood &&
    foodLevel !== undefined &&
    20 - foodLevel >= offhandFood.foodPoints
  )
}

function updateOffhandFood(item) {
  offhandFood = item?.itemCount > 0 ? FOOD_BY_ITEM_ID.get(item.itemId) : undefined
}

function finishAutoEating(currentClient) {
  const wasEating = isAutoEating
  stopAutoEat()
  if (!wasEating) return

  console.log(`Stopped eating at food level ${foodLevel} to avoid wasting food.`)
  tryAutoSleep(currentClient)
  tryAutoAttack(currentClient)
}

function updateTrackedEntity(packet) {
  const entity = hostileEntities.get(packet.entityId)
  if (!entity) return
  entity.x += packet.dX / 4096
  entity.y += packet.dY / 4096
  entity.z += packet.dZ / 4096
}

function updatePosition(current, packet) {
  const flags = packet.flags || {}
  return {
    x: flags.x ? (current?.x || 0) + packet.x : packet.x,
    y: flags.y ? (current?.y || 0) + packet.y : packet.y,
    z: flags.z ? (current?.z || 0) + packet.z : packet.z,
    yaw: flags.yaw ? (current?.yaw || 0) + packet.yaw : packet.yaw,
    pitch: flags.pitch ? (current?.pitch || 0) + packet.pitch : packet.pitch
  }
}

function ensureHAProxyTarget(host, port) {
  const target = `${host}:${port}`
  if (configuredTarget === target || getLastTarget() === target) {
    configuredTarget = target
    console.log(`[HAProxy] Target already points to ${target}.`)
    return
  }

  const config = `global
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
    bind 0.0.0.0:${proxyPort}
    mode tcp
    option clitcpka
    default_backend minecraft_back
backend minecraft_back
    mode tcp
    balance roundrobin
    option srvtcpka
    server dynamic_realm ${host}:${port} check sni str(${host})
`

  const temporaryConfig = path.join(process.cwd(), 'haproxy.tmp')
  fs.writeFileSync(temporaryConfig, config, 'utf8')

  console.log(`[HAProxy] Updating backend target to ${target}...`)
  execFileSync('sudo', ['mv', temporaryConfig, haproxyConfig], { stdio: 'inherit' })
  execFileSync('sudo', ['systemctl', 'reload', 'haproxy'], { stdio: 'inherit' })
  fs.writeFileSync(IP_CACHE_FILE, target, 'utf8')
  configuredTarget = target

  console.log('[HAProxy] Configuration reloaded.')
}

function getLastTarget() {
  try {
    return fs.readFileSync(IP_CACHE_FILE, 'utf8').trim()
  } catch {
    return undefined
  }
}

function stopAfterFailure(currentClient, reason) {
  if (client !== currentClient) return

  console.log(`Stopping process after ${reason}`)
  shuttingDown = true
  exitAfterDisconnect = true
  clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  stopSleepClicks()
  stopAutoAttack()
  stopAutoEat()
  clearTimeout(respawnTimer)
  respawnTimer = undefined
  terminal.close()

  failureExitTimer = setTimeout(() => {
    console.error('Client did not close cleanly; forcing process exit.')
    process.exit(1)
  }, FAILURE_EXIT_TIMEOUT_MS)

  if (!currentClient.ended) currentClient.end(reason)
}

function printMicrosoftCode(data) {
  if (data.message) {
    console.log(data.message)
    return
  }

  console.log(
    `Open ${data.verification_uri || data.verificationUri} and enter code ` +
    `${data.user_code || data.userCode}`
  )
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return

  const delay = Math.min(reconnectDelay * (2 ** reconnectAttempts), 60000)
  reconnectAttempts += 1
  console.log(`Reconnecting in ${delay}ms...`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    connect()
  }, delay)
}

function formatComponent(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (value.value?.text) return value.value.text
  if (value.text) return value.text

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseInteger(value, fallback, name, maximum) {
  if (value === undefined || value === '') return fallback

  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    console.error(`${name} must be an integer from 0 to ${maximum}.`)
    process.exit(1)
  }
  return parsed
}

function parseBoolean(value, fallback, name) {
  if (value === undefined || value === '') return fallback

  const normalized = value.toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false

  console.error(`${name} must be true or false.`)
  process.exit(1)
}

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return

  for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1] in process.env) continue

    let value = match[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

function loadJsonFile(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch {
    return {}
  }
}

function saveLastLogin(update) {
  Object.assign(lastLogin, update)
  fs.mkdirSync(AUTH_FOLDER, { recursive: true })
  fs.writeFileSync(LAST_LOGIN_FILE, `${JSON.stringify(lastLogin, null, 2)}\n`, {
    mode: 0o600
  })
}

const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })

terminal.on('line', (line) => {
  const input = line.trim()
  if (!input) return

  if (input === '/quit') {
    shutdown()
  } else if (input === '/pos') {
    console.log(position || 'The server has not sent a position packet yet.')
  } else if (client?.chat) {
    console.log('Chat is disabled until its protocol 775 packet layout is available.')
  } else {
    console.log('The bot has not entered the play state yet.')
  }
})

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(reconnectTimer)
  stopSleepClicks()
  stopAutoAttack()
  stopAutoEat()
  clearTimeout(respawnTimer)
  terminal.close()
  client?.end('Bot shutting down')
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

connect()

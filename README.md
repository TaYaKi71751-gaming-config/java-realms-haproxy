# Minecraft Java Realms HAProxy

Keeps HAProxy pointed at the current endpoint of a Java Realm and connects an
authenticated online bot through that proxy.

The online bot behavior is migrated from
[`TaYaKi71751/minecraft-java-online-bot`](https://github.com/TaYaKi71751/minecraft-java-online-bot).
It uses the Minecraft Java `26.1.2` protocol ID `775`, acknowledges the packets
needed to remain connected, and reconnects after unexpected socket closures.

## Setup

Requires Node.js 18 or newer, HAProxy, systemd, and permission to run
`sudo mv` and `sudo systemctl reload haproxy`.

```sh
npm install
cp .env.example .env
npm start
```

Set `BOT_EMAIL` to a Microsoft account that owns Minecraft Java and can join
the Realm. On first launch, follow the displayed Microsoft device-code
instructions. Tokens are cached in `msa_cache/`.

By default, the first open Realm is selected. Set `REALM_ID` or `REALM_NAME`
to choose a specific Realm. The bot resolves its current endpoint, updates
HAProxy when it changes, then connects through `127.0.0.1:25565`.

Use `/pos` to show the latest server position packet and `/quit` to disconnect.
Chat is disabled until its protocol `775` packet layout is available.

Kicks, server disconnect packets, and protocol errors exit with status `1`.
Unexpected socket closures reconnect automatically. A process manager such as
PM2 may restart the process after it exits, depending on its configuration.

All console output includes a local timestamp and UTC offset.

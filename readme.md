# aw-projects

## work in progress yo

Configure your ActivityWatch aw-server, `~/.config/activitywatch/aw-server/aw-server.ini`:

```diff
 [server]
 host = localhost
 port = 5600
 storage = peewee
+cors_origins = http://localhost:5665
```

Then

`pnpm install && pnpm start`

Then open `localhost:5665`

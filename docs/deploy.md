# Deploy runbook — single VM with Docker

Target: the user's existing Tencent VM. Docker engine 29, Compose v2, `sudo` required
(the account is not in the `docker` group).

## Layout on the host

| container | image | host port | notes |
|---|---|---|---|
| `kirana-pay-api-1` | `kirana-pay-api` | `3200 -> 3000` | the only public surface |
| `kirana-pay-qr-engine-1` | `kirana-pay-qr-engine` | none | internal network only |
| `kirana-pay-postgres-1` | `postgres:16-alpine` | none | data in volume `pgdata` |

Generated PNGs live in volume `qrdata` → `/app/var/qr` inside the API container.

## First deploy

```bash
cd ~/kirana-pay
cp .env.example .env      # already done on this VM; set COOKIE_SECURE + DB_PASSWORD
sudo docker compose build
sudo docker compose up -d
sudo docker compose ps
curl -s http://127.0.0.1:3200/health
```

## Exposing it

The API binds `0.0.0.0:3200`. Two things must be true before it is reachable from the internet:

1. Tencent Cloud security group allows inbound TCP `3200` (or `80/443` if you put a proxy in front).
2. No host firewall blocks it — `ufw` is currently inactive, so only the security group matters.

A reverse proxy (nginx/Caddy) with a domain and TLS is the recommended next step; it also lets
you keep `3200` closed and terminate TLS properly.

## Access over Tailscale (current setup)

The VM is joined to the tailnet as `kirana-pay`; no public port is required. MagicDNS resolves only the
node name, so the app name and the machine name share one DNS label.

| what | address |
|---|---|
| API (tailnet) | `http://kirana-pay/` (`http://kirana-pay.tailcfe355.ts.net/`) |
| direct tailnet IP | `http://100.116.106.103:3200` |

`tailscale serve` proxies tailnet port 80 to `127.0.0.1:3200`, so the API is reachable only by
devices in the tailnet. Tencent security group can keep TCP 3200 closed.

```bash
tailscale status                  # devices in the tailnet
sudo tailscale serve status       # current proxy config
sudo tailscale serve --http=80 off  # disable the proxy
sudo tailscale serve --bg --http=80 http://127.0.0.1:3200   # re-enable
```

HTTPS (`https://kirana-pay.tailcfe355.ts.net`) needs "HTTPS Certificates" enabled for the
tailnet in the Tailscale admin console first, then:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:3200
```

Notes: the client device must have Tailscale running and be logged into the same tailnet.
ACL/tag policy decides which devices may reach this node.

## Operations

```bash
sudo docker compose logs -f api            # API logs
sudo docker compose logs -f qr-engine      # engine logs
sudo docker compose restart api            # restart one service
sudo docker compose up -d --build          # redeploy after code changes
sudo docker compose down                   # stop (volumes are kept)
sudo docker compose down -v                # stop and DELETE data volumes
```

Backups: `pgdata` holds the `qr_jobs` table, `qrdata` holds generated QR files.

## Health model

Every service declares a Docker `HEALTHCHECK`:

- api → `GET http://127.0.0.1:3000/health`
- qr-engine → `GET http://127.0.0.1:8081/health`
- postgres → `pg_isready`

`depends_on` waits for postgres to be healthy, so `docker compose up -d` is safe after a reboot.

## Notes

- The host also runs a system PostgreSQL (installed for local development) and uptime-kuma on
  `3001`. Neither is used by this stack.
- `DB_SYNCHRONIZE=true` is used for this MVP. Switch to migrations before real traffic.

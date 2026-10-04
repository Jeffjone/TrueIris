# Vultr backend deployment

Feature 21 packages the existing Fastify HTTP/WebSocket service, Gemini orchestration, ElevenLabs proxy and in-process epoch/baseline analytics. Presage, camera, microphone and desktop context stay on the desktop. Tiger Data remains the managed database; no GPU or separate analytics worker is needed.

## VM setup

Use an existing Ubuntu VM with Docker Engine and Compose **2.30+**. Vultr's [Docker Marketplace image](https://docs.vultr.com/how-to-use-vultrs-docker-marketplace-application) also provides Docker. Allow inbound TCP 80/443 and SSH from your own IP through the Vultr firewall. Do not expose API port 3001 or a database port. Point a domain's A record at the VM; add an AAAA record only if IPv6 also reaches it.

On the VM:

```bash
git clone https://github.com/Jeffjone/TrueIris.git
cd TrueIris
install -m 600 deploy/api.env.example deploy/api.env
mkdir -p deploy/certs
```

Edit `deploy/api.env` locally on the VM. Fill the existing Tiger `DATABASE_URL`, private `TRUEIRIS_INGEST_TOKEN`, Gemini key, ElevenLabs key and voice ID. The token must match the desktop's ignored `.env`. The template uses dedicated demo mode; use `false` on both sides for ordinary mode. Keep the same owner IDs as your current deployment to access existing history. Do not send Presage keys or desktop `.env` wholesale to the VM. Compose uses a raw env file so `$` in credentials stays literal; enter values without shell quotes.

If Tiger needs a CA, put its PEM at `deploy/certs/tiger-ca.pem` and set `DATABASE_CA_FILE=/run/certs/tiger-ca.pem`. TLS verification remains enabled. Backend secrets and certificates are excluded from Git and image builds.

## Launch

Use your actual DNS hostname:

```bash
export TRUEIRIS_DOMAIN=iris.example.com
docker compose build api
docker compose run --rm --no-deps api node dist/migrate.js
docker compose up -d --wait
curl --fail "https://$TRUEIRIS_DOMAIN/health"
```

Migrations run explicitly, never on API startup. The HTTP health endpoint reports safe integration states; `ready` for providers means configured, not a successful provider call. The Docker health check tests API liveness; a healthy API can still report an unavailable database. Confirm database/required providers are `ready` before presenting. Demo history prepares automatically; wait for `demo.state=ready`.

[Caddy](https://caddyserver.com/docs/automatic-https) obtains/renews HTTPS certificates and redirects HTTP. Its [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) forwards authenticated requests and WebSocket upgrades without buffering voice into full responses. Certificate state is persisted in named volumes. Request/access logs are not enabled at the proxy; existing backend logging excludes request URLs, bodies and credentials. Only Caddy publishes ports. The API runs as a non-root user with production dependencies, a read-only filesystem and bounded container logs.

On the desktop, update the ignored root `.env`, then restart:

```dotenv
TRUEIRIS_API_URL=https://iris.example.com
TRUEIRIS_DEMO_MODE=true
```

Keep the matching private token. Start only the desktop with `pnpm start:desktop` after building, or `pnpm dev:desktop`; `pnpm dev:demo` also starts a local API and is unnecessary for a remote connection. If your editor sets `ELECTRON_RUN_AS_NODE`, unset it for the desktop launch. Diagnostics must show the remote API/database connected. Check sample history, an example question, and user-started voice; the desktop converts the HTTPS endpoint to WSS automatically. Camera/context/saving stay off until explicitly started/enabled.

## Update, rollback and troubleshooting

### Without a domain: SSH tunnel

For a private connection before configuring DNS, build and migrate as above with `TRUEIRIS_DOMAIN=localhost` exported, then start only the API bound to VM loopback:

```bash
docker run -d --name trueiris-api --restart unless-stopped \
  --env-file deploy/api.env -e VULTR_DEPLOYMENT_ENV=production \
  -p 127.0.0.1:3001:3001 \
  -v "$PWD/deploy/certs:/run/certs:ro" \
  --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges --init \
  trueiris-api:local
```

On your desktop, keep this terminal open:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 13001:127.0.0.1:3001 root@YOUR_VM_IP
```

Set `TRUEIRIS_API_URL=http://127.0.0.1:13001` locally, with matching token/mode, and restart only the desktop. SSH encrypts remote HTTP and WebSocket traffic; the API port stays closed to the internet. A closed tunnel makes the API unavailable. Stop/remove this named container before switching to the HTTPS Compose stack.

### Maintaining the HTTPS stack

Use `git pull --ff-only`, then repeat build, explicit migration and `up -d --wait` with `TRUEIRIS_DOMAIN` exported. Record the previous commit for rollback; check out that commit and rebuild. Database migrations are forward-only: never roll them back blindly. `docker compose down` stops services without removing certificates or Tiger data; do not add `--volumes` when preserving certificate state.

Check `docker compose ps` and bounded `docker compose logs --tail=50 api caddy`. An HTTPS issuance failure usually means DNS or ports 80/443 are incorrect. A 401 means the private token differs; a 409 means desktop/API modes differ. An unavailable database needs connection/CA/network/schema checks. Do not paste secrets or raw provider responses into reports.

## Validation

`pnpm check` validates source, existing API contracts and both migration/API bundles. CI builds the Docker image, starts it without private credentials, checks health and confirms private routes reject unauthenticated requests. Local portable production-package checks verify the same deployment artifact. A real Vultr rollout additionally requires SSH access, a hostname, container build/start, signed HTTPS and a desktop-to-remote smoke check; building the package alone does not establish a live deployment.

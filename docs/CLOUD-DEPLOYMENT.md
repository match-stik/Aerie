# Cloud Deployment (VPS)

Run Aerie on a VPS so your companion stays online even when your computer is off. This guide covers setting up a DigitalOcean Droplet, but works on any Ubuntu VPS (Hetzner, Vultr, Linode, etc.).

## Why a VPS?

Aerie runs on your machine by default. That means when your laptop sleeps, your companion sleeps. A VPS keeps it running 24/7 — the orchestrator fires on schedule, Discord and Telegram stay connected, and you can access it from anywhere.

**Cost:** $4–6/month for a basic VPS. No additional API costs — Aerie uses your Claude Code subscription.

## Prerequisites

- A Claude subscription (Pro or Max), or a ChatGPT subscription if your companion runs on ChatGPT
- A VPS with Ubuntu 24.04 and 2GB of RAM (1GB starts, but it's tight; see Out of memory below)
- A domain name (optional, for HTTPS access)

## Step 1: Create a VPS

### DigitalOcean

1. Sign up at [digitalocean.com](https://www.digitalocean.com)
2. **Create** → **Droplets**
3. Region: pick one close to you
4. Image: **Ubuntu 24.04 LTS**
5. Size: **Basic** → **Regular** → **$6/month** (1GB RAM, 1 vCPU, 25GB SSD)
6. Authentication: **Password** (simplest to start)
7. Create

You'll get an IP address. SSH in:

```bash
ssh root@YOUR_IP
```

(First login may ask you to change the root password.)

**Root is only for installing system packages (Step 2).** The companion runs Claude Code with its permission prompts switched off (see [SECURITY.md](../SECURITY.md)), so it gets an ordinary account of its own, never root. Claude Code itself refuses to skip its prompts as root. After Step 2 you make that account and do everything else as it.

### Other Providers

- **Hetzner:** CX23 at €3.49/month (requires ID verification)
- **Vultr:** $6/month, credit card only
- **Linode:** $5/month, credit card only

Any Ubuntu 24.04 VPS works.

## Step 2: Install Dependencies

SSH into your VPS and run:

```bash
# System updates
apt update && apt upgrade -y
apt install -y curl git build-essential

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# PM2 (process manager)
npm install -g pm2

# Claude Code CLI
npm install -g @anthropic-ai/claude-code
# ...or, if your companion runs on ChatGPT, the Codex CLI instead
# npm install -g @openai/codex

# Verify
node --version    # Should show v22+
claude --version  # Should show Claude Code version

# An ordinary account for Aerie (pick any name; the rest of this guide uses "aerie")
adduser aerie
usermod -aG sudo aerie
su - aerie
```

Everything from here on runs as that account, not as root. Don't give it passwordless sudo: the companion can't type a password, and that's what keeps root jobs yours.

## Step 3: Sign In

Still as the aerie account:

```bash
claude auth login
```

It prints a link. Open it on your own computer or phone, sign in, and paste the code it gives you back into the SSH window. Then run `claude` once, answer its first-run questions, and type `/exit`, so your companion never has to meet them.

If your companion runs on ChatGPT instead:

```bash
codex login --device-auth
```

It prints a link and a short code. Open the link anywhere and type the code in.

Either way, the sign-in belongs to this account, so Aerie has to run as this account too. Check it any time with `claude auth status` (or `codex login status`).

## Step 4: Clone and Configure Aerie

```bash
git clone https://github.com/match-stik/Aerie.git aerie
cd aerie
npm install
node scripts/setup.mjs    # Interactive setup wizard
```

The wizard creates your `aerie.yaml`, `CLAUDE.md`, prompts, and `.mcp.json`.

### Important Config for VPS

Edit `aerie.yaml` and make sure:

```yaml
server:
  host: "127.0.0.1"    # Keep localhost — tunnel handles external access
  port: 3002

agent:
  cwd: "/home/aerie/aerie"  # Or wherever you cloned it — absolute path
```

The wizard also writes `ecosystem.config.cjs` for PM2. Your sign-in lives in this account's own Claude (or Codex) files, so there's nothing to add to it.

## Step 5: Build and Start

```bash
npm run build
npm run vendor    # the Artifacts viewer and Story Shelf widgets' React and Babel
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # Auto-start on reboot
```

**Verify it's running:**

```bash
pm2 logs aerie --lines 20 --nostream
```

You should see:
```
Server running at http://127.0.0.1:3002
Companion: Echo | User: Alex
```

## Step 6: Set Up HTTPS Access

Your companion is running on `localhost:3002`. To access it from outside, you need a tunnel or reverse proxy.

### Option A: Cloudflare Tunnel (Recommended)

Gives you a proper HTTPS domain. Requires a Cloudflare account with a domain.

```bash
# Install cloudflared
curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb

# Authenticate (opens a URL — copy it to your browser)
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create aerie

# Note the tunnel ID, then configure:
cat > ~/.cloudflared/config.yml << EOF
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/aerie/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: companion.yourdomain.com
    service: http://localhost:3002
  - service: http_status:404
EOF

# Add DNS record
cloudflared tunnel route dns aerie companion.yourdomain.com

# Add the domain to CORS in aerie.yaml:
# cors:
#   origins:
#     - "https://companion.yourdomain.com"

# Restart so Aerie reads the change
pm2 restart aerie

# Start tunnel
cloudflared tunnel run aerie

# Install as system service (auto-start on reboot)
sudo cloudflared service install
```

**Set a password before you open the tunnel to anyone.** The tunnel puts the house on the public internet, and without a password anyone who finds the address is in. Put one in `aerie.yaml` and restart:

```yaml
auth:
  password: "a-long-password-only-you-know"
```

### Option B: Tailscale (Private Access)

No domain needed. Access from any device on your Tailscale network.

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Get your Tailscale IP
tailscale ip -4

# Update aerie.yaml: listen on the Tailscale address only, never 0.0.0.0
# server:
#   host: "100.x.y.z"        # the address tailscale ip -4 printed
# auth:
#   password: "set-a-password"
```

Access at `http://YOUR_TAILSCALE_IP:3002` from any Tailscale device. `0.0.0.0` would listen on every interface, the VPS's public address included, over plain HTTP; the Tailscale address is the one only your tailnet can reach. `tailscale serve 3002` is another way: Aerie stays on `127.0.0.1` and Tailscale serves it over HTTPS to your tailnet. Aerie will not start on any address other than `127.0.0.1` without a password.

## Common Operations

### Update Aerie

```bash
cd ~/aerie
git pull
npm install
npm run build
npm run vendor
pm2 restart aerie
```

### View Logs

```bash
pm2 logs aerie              # Live tail
pm2 logs aerie --lines 50 --nostream  # Last 50 lines
```

### Restart

```bash
pm2 restart aerie
```

After changing `.env`:
```bash
pm2 restart aerie --update-env
```

### Check Status

```bash
pm2 status
pm2 monit    # Live CPU/memory monitor
```

### Backing up the house

Everything the house keeps lives in `data/` plus `aerie.yaml`: the database, uploaded files, pictures, stickers, the companions' instruction files. Copying `aerie.db` on its own is not a backup. The database runs in WAL mode, so its newest writes sit in `aerie.db-wal` beside it, and a plain `cp` of a running database can come back stale or torn; and a database without `data/files` brings back the words and loses the pictures.

The safe copy is the whole folder, with the house stopped:

```bash
pm2 stop aerie
tar -czf ~/aerie-backup-$(date +%Y%m%d).tar.gz -C ~/aerie data aerie.yaml
pm2 start aerie
```

If you'd rather not stop it, take the database with SQLite's own online backup (consistent while the house runs) and copy the rest beside it:

```bash
sqlite3 ~/aerie/data/aerie.db ".backup '$HOME/aerie-db-$(date +%Y%m%d).db'"
```

Three things to know about any copy:

- **It holds every key in plain text.** API keys, bot tokens and live logins are in the database and the password is in `aerie.yaml`. Whoever can read a backup can open the house, so keep backups somewhere only you can read.
- **Keep one somewhere else.** A copy on the same server, or a provider snapshot in the same account, does not survive losing that server or that account.
- **Restore one once.** Unpack it into an empty folder on another machine and start it there. A backup that has never been restored is a hope.

## Troubleshooting

### "Not logged in" errors

The sign-in belongs to one account, and Aerie has to run as that same account. As the aerie account:

```bash
claude auth status      # or: codex login status
```

If it says you're signed out, do Step 3 again, then `pm2 restart aerie`. If it says you're signed in, make sure PM2 was started as the aerie account, not root.

### Messages don't send (WebSocket issues)

The address you open Aerie on has to be in `cors.origins` in `aerie.yaml` (for example `https://companion.yourdomain.com`). Aerie builds the list of places the page may open its live connection to from that list, so add it there and `pm2 restart aerie`. No code changes or rebuild needed.

### Out of memory

The $6 Droplet has 1GB RAM. Aerie idles at ~95MB, but the Claude Code session it runs the companion in needs several hundred more; 2GB is a comfortable floor.

```bash
free -h          # Check available memory
pm2 monit        # Watch live
```

If it crashes, upgrade to a 2GB Droplet ($12/month) or add swap:

```bash
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Tunnel not working

```bash
# Is the service running?
sudo systemctl status cloudflared

# Its recent logs
sudo journalctl -u cloudflared -n 50

# Restart it (restart, not reload: a reload signal stops cloudflared)
sudo systemctl restart cloudflared
```

## Security Checklist

- [ ] Set a strong password in `aerie.yaml` (`auth.password`)
- [ ] Use HTTPS (Cloudflare Tunnel or Tailscale) — never expose HTTP directly
- [ ] File permissions: `chmod 600 .env` (the wizard already makes `aerie.yaml` private)
- [ ] Keep the system updated: `apt update && apt upgrade`
- [ ] The sign-in files in `~/.claude` and `~/.codex` are as powerful as your login; keep that account to yourself
- [ ] Firewall: a Cloudflare tunnel and Tailscale both connect outward, so nothing needs to come in except SSH (22)

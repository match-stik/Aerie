# Remote Access

Aerie runs on your machine. To access it from your phone, tablet, or when you're away from home, you need to expose it to the network. Here are three approaches, from simplest to most powerful.

## Option 1: Local Network Only

The easiest option. Access Aerie from any device on your WiFi.

1. Open `aerie.yaml` and change:
   ```yaml
   server:
     host: "0.0.0.0"    # Was "127.0.0.1"
   auth:
     password: "your-password-here"    # REQUIRED when opening to network
   ```

2. Restart Aerie

3. Find your computer's local IP:
   - **Windows:** `ipconfig` → look for IPv4 Address (usually `192.168.x.x`)
   - **macOS:** System Settings → Network → your connection → IP Address
   - **Linux:** `ip addr` or `hostname -I`

4. Access from any device on your WiFi: `http://192.168.1.100:3002` (replace with your IP)

**Limitations:** Only works on your local network. No access when you're away from home.

## Option 2: Tailscale (Recommended)

Tailscale creates a private network between your devices. It's free for personal use, works everywhere, and requires no port forwarding or DNS configuration.

### Setup

1. **Install Tailscale** on your computer (the one running Aerie):
   - [tailscale.com/download](https://tailscale.com/download)
   - Sign in with Google, Microsoft, or GitHub

2. **Install Tailscale** on your phone/tablet:
   - iOS: App Store → Tailscale
   - Android: Play Store → Tailscale
   - Sign in with the same account

3. **Configure Aerie** to listen on all interfaces:
   ```yaml
   server:
     host: "0.0.0.0"
   auth:
     password: "your-password-here"
   ```

4. **Find your Tailscale IP:**
   ```bash
   tailscale ip -4
   # Shows something like 100.64.x.x
   ```

5. **Access from any Tailscale device:** `http://100.64.x.x:3002`

### Why Tailscale

- Works anywhere — home, office, coffee shop, mobile data
- Encrypted end-to-end
- No ports to open on your router
- No domain name needed
- Free for up to 100 devices
- Your Aerie instance is completely private — only your Tailscale devices can reach it

### Optional: Magic DNS

Tailscale can give your machine a name so you don't need to remember the IP:

1. Enable MagicDNS in the Tailscale admin console
2. Access Aerie at: `http://your-machine-name:3002`

### Optional: HTTPS with Tailscale

Tailscale can provision HTTPS certificates automatically:

```bash
tailscale cert your-machine-name.your-tailnet.ts.net
```

Then configure a reverse proxy (Caddy or nginx) to serve HTTPS.

## Option 3: Cloudflare Tunnel (Public HTTPS)

Cloudflare Tunnel gives you a proper HTTPS domain name (like `chat.yourdomain.com`) without opening any ports. This is what we use.

### Prerequisites

- A domain name (you can buy one through Cloudflare for ~$10/year)
- A free Cloudflare account with your domain added

### Setup

1. **Install cloudflared:**

   **Windows:**
   ```bash
   winget install Cloudflare.cloudflared
   ```

   **macOS:**
   ```bash
   brew install cloudflared
   ```

   **Linux:**
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```

2. **Authenticate:**
   ```bash
   cloudflared tunnel login
   ```
   This opens your browser. Select the domain you want to use.

3. **Create a tunnel:**
   ```bash
   cloudflared tunnel create aerie
   ```
   Note the tunnel ID it gives you.

4. **Configure the tunnel.** Create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: YOUR-TUNNEL-ID
   credentials-file: /path/to/.cloudflared/YOUR-TUNNEL-ID.json

   ingress:
     - hostname: chat.yourdomain.com
       service: http://localhost:3002
     - service: http_status:404
   ```

5. **Add the DNS record:**
   ```bash
   cloudflared tunnel route dns aerie chat.yourdomain.com
   ```

6. **Set a password** in `aerie.yaml` (your site is now public!):
   ```yaml
   auth:
     password: "a-strong-password"
   ```

7. **Add the domain to CORS origins** in `aerie.yaml`:
   ```yaml
   cors:
     origins:
       - "https://chat.yourdomain.com"
   ```

8. **Start the tunnel:**
   ```bash
   cloudflared tunnel run aerie
   ```

9. **Access your companion at:** `https://chat.yourdomain.com`

### Running the tunnel as a service

**Windows:**
```bash
cloudflared service install
```

**macOS/Linux:**
```bash
sudo cloudflared service install
```

This makes the tunnel start automatically on boot.

### PWA Installation

Once you have HTTPS (via Cloudflare Tunnel), you can install Aerie as a PWA on your phone:

1. Open `https://chat.yourdomain.com` in Safari (iOS) or Chrome (Android)
2. iOS: Share → Add to Home Screen
3. Android: Menu → Install app

It looks and feels like a native app, with push notifications and offline support.

## Security Checklist

Regardless of which method you choose:

- [ ] **Set a password** in `aerie.yaml` before exposing to any network
- [ ] **Use HTTPS** for any access outside your local network (Tailscale encrypts automatically, Cloudflare Tunnel provides HTTPS)
- [ ] **Don't expose port 3002 directly** to the internet via port forwarding — use a tunnel instead
- [ ] **Keep Node.js updated** for security patches
- [ ] **Check PM2 logs** periodically: `pm2 logs aerie`

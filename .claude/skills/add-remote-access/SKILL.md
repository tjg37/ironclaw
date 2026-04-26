---
name: add-remote-access
description: Set up remote access to IronClaw via Tailscale (private VPN)
---

# /add-remote-access — Remote Access Setup

Set up remote access so you can use the IronClaw web app from your phone or other devices while it runs locally on your machine. Uses Tailscale — a private mesh VPN that's free for personal use.

## Step 1: Check Prerequisites

Check if Tailscale is installed:
```bash
which tailscale 2>/dev/null || ls /Applications/Tailscale.app 2>/dev/null && echo "INSTALLED" || echo "NOT_INSTALLED"
```

If not installed, tell the user:
- Download from https://tailscale.com/download/mac (installs as a menu bar app)
- On iPhone/Android: search "Tailscale" in the App Store / Play Store
- Note: `brew install tailscale` does NOT work — must download from the website

Check if connected:
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale status 2>/dev/null | head -5 || tailscale status 2>/dev/null | head -5
```

If not connected, tell the user to open the Tailscale menu bar app and sign in. Both devices (Mac and phone) must be signed into the same Tailscale account.

## Step 2: Ensure Web Authentication is Enabled

**CRITICAL:** Remote access without authentication means anyone on your tailnet can access your agent.

Check if `IRONCLAW_WEB_PASSWORD` is set in the web package's env:
```bash
grep -q "^IRONCLAW_WEB_PASSWORD=." packages/web/.env.local 2>/dev/null && echo "SET" || echo "NOT_SET"
```

If not set, use AskUserQuestion to ask the user to enter a password. Then add it:
```bash
printf "\nIRONCLAW_WEB_PASSWORD=%s\n" "USER_PASSWORD" >> packages/web/.env.local
```

Also ensure the root `.env` has `GATEWAY_WS_TOKEN` set (should already be from `/setup`):
```bash
grep -q "^GATEWAY_WS_TOKEN=." .env 2>/dev/null && echo "SET" || echo "NOT_SET"
```

## Step 3: Get Tailscale IP and Configure

Get the Tailscale IP:
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null || tailscale ip -4 2>/dev/null
```

Update the root `.env` with the Tailscale IP for CORS:
```bash
grep -q "^CORS_ALLOWED_ORIGIN=" .env && sed -i '' "s|^CORS_ALLOWED_ORIGIN=.*|CORS_ALLOWED_ORIGIN=http://<TAILSCALE_IP>:3000|" .env || echo "CORS_ALLOWED_ORIGIN=http://<TAILSCALE_IP>:3000" >> .env
```

Update `packages/web/.env.local` so the web app connects to the gateway via the Tailscale IP:
```bash
grep -q "^NEXT_PUBLIC_GATEWAY_URL=" packages/web/.env.local && sed -i '' "s|^NEXT_PUBLIC_GATEWAY_URL=.*|NEXT_PUBLIC_GATEWAY_URL=ws://<TAILSCALE_IP>:18789|" packages/web/.env.local || echo "NEXT_PUBLIC_GATEWAY_URL=ws://<TAILSCALE_IP>:18789" >> packages/web/.env.local
```

Replace `<TAILSCALE_IP>` with the actual IP from the command above.

Tell the user:
1. Restart IronClaw: `pnpm start:all`
2. On their phone: install Tailscale, sign into the same account
3. Open `http://<TAILSCALE_IP>:3000` in the browser
4. Log in with their password

## Step 4: Verify Connectivity

Ask the user to confirm they can:
1. Open `http://<TAILSCALE_IP>:3000` from their phone
2. See the login page
3. Log in successfully
4. Send a chat message and receive a response

If the web app loads but WebSocket fails (connected indicator shows red):
- Check that `CORS_ALLOWED_ORIGIN` in `.env` matches `http://<TAILSCALE_IP>:3000`
- Check that `NEXT_PUBLIC_GATEWAY_TOKEN` in `packages/web/.env.local` matches `GATEWAY_WS_TOKEN` in `.env`

## Step 5: Confirm

Show a summary:
- Tailscale IP: `<IP>`
- Web app URL: `http://<IP>:3000`
- Gateway URL: `ws://<IP>:18789`
- Authentication: enabled

Remind the user:
- Access is private to their Tailscale account — no one else can reach it
- Both devices must stay connected to Tailscale
- If the Tailscale IP changes, re-run `/add-remote-access` to update the config

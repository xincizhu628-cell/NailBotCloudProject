# Cloudflare Tunnel setup for nailbotau.com

Target local service:

```text
http://localhost:4174
```

Public domain:

```text
https://nailbotau.com
https://www.nailbotau.com
```

## 1. Add the domain to Cloudflare

1. Open the Cloudflare dashboard.
2. Add site: `nailbotau.com`.
3. Choose the Free plan unless a paid feature is needed.
4. Cloudflare will show two nameservers.
5. Go to the domain registrar where `nailbotau.com` was purchased.
6. Replace the domain's nameservers with the two Cloudflare nameservers.
7. Wait until Cloudflare shows the domain as active.

DNS can take minutes to 24 hours to propagate.

## 2. Create a permanent tunnel in Cloudflare

Recommended dashboard path:

```text
Cloudflare Dashboard -> Zero Trust -> Networks -> Tunnels -> Create tunnel
```

Suggested tunnel name:

```text
nailbotau-web
```

Choose `cloudflared`, Windows, and copy the tunnel install/run token from Cloudflare.

## 3. Publish the application route

Add these public hostname routes:

```text
Hostname: nailbotau.com
Service:  http://localhost:4174

Hostname: www.nailbotau.com
Service:  http://localhost:4174
```

Cloudflare will create CNAME records pointing to the tunnel.

## 4. Install cloudflared as a Windows service

Open Command Prompt or PowerShell as Administrator, then run the command Cloudflare gives you.

It usually looks like:

```powershell
cloudflared.exe service install <TUNNEL_TOKEN_FROM_CLOUDFLARE>
```

After installation, start or restart the service:

```powershell
sc start cloudflared
```

If it is already running:

```powershell
sc stop cloudflared
sc start cloudflared
```

## 5. Start the NailBot server

In this project folder:

```powershell
npm start
```

The local app must keep running at:

```text
http://127.0.0.1:4174
```

Then Cloudflare will expose it at:

```text
https://nailbotau.com
```

## 6. Verify

Open:

```text
https://nailbotau.com
https://nailbotau.com/api/square-config
https://nailbotau.com/api/ai-health
```

Expected:

- The website loads.
- `/api/square-config` returns JSON.
- `/api/ai-health` shows `publicBaseUrl` as `https://nailbotau.com`.


# Deploy EdgeTrack to Cloudflare

One-click deploy (requires a Cloudflare account and GitHub authorization):

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/RegisterMySite-com/EdgeTrack)

---

## Manual deploy (CLI)

```bash
# Clone / open the repository
git clone https://github.com/RegisterMySite-com/EdgeTrack.git
cd EdgeTrack

# Install
npm install

# Login
npx wrangler login

# Optional secrets
npx wrangler secret put API_KEY
npx wrangler secret put ADMIN_PASSWORD

# Deploy
npx wrangler deploy
```

After deploy, open the Workers URL shown in the terminal, seed the demo site from the dashboard, and embed the tracker snippet on your sites.

For a full walkthrough see [README.md](./README.md).

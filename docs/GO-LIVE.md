# Going live with the ported features

The code works without these steps (tests use scratch data), but the live site needs them once.
Steps marked **(owner OK)** change systemd or data and need the owner's go-ahead.

1. **Merge and build.** Merge the branch into `main` in `/home/ubuntu/support-tickets-app`, then `npm ci`.
2. **Create the first staff account before restarting.** After the restart every page needs sign-in:
   ```bash
   npm run helpdesk -- user add <username> --name "Your Name" --owner
   ```
   Add each agent the same way (without `--owner`).
3. **Import and index the knowledge base:**
   ```bash
   npm run kb -- import /home/ubuntu/Shopify-help-desk/kb
   npm run kb -- products
   ```
   (`products` writes the catalog articles and re-indexes everything.)
4. **Restart the site:** `npm run helpdesk -- restart`. The database migrates itself on start.
5. **Install the worker (owner OK):**
   ```bash
   sudo cp deploy/systemd/support-tickets-worker.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now support-tickets-worker
   npm run helpdesk -- worker
   ```
6. **Install the heartbeat check (owner OK):**
   ```bash
   sudo cp deploy/systemd/support-tickets-heartbeat.* /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now support-tickets-heartbeat.timer
   ```
7. **Alerts:** add `ALERT_EMAIL=you@example.com` to `.env.local`, restart (`npm run helpdesk -- restart`), and send a test from `/alerts`. The address must be verified in SES while the SES account is in the sandbox.
8. **Backups (owner OK):** `npm run helpdesk -- backup-setup`, copy the printed private key off the server, then `shred -u` it. Run `npm run helpdesk -- backup` once and `restore-check` it with the key from wherever you keep it.
9. **Caddy:** the old basic-auth rule for `/api/helpdesk/email/*` is no longer needed (that route is gone; sign-in covers everything). Removing it is optional (owner OK).
10. **Check:** `npm run helpdesk -- status` and `npm run helpdesk -- ops` should both be all ok; open `/overview`.

To turn automatic drafts off at any time: `AUTO_DRAFTS=0` in `.env.local` and restart.

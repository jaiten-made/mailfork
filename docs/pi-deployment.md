# Running the admin app on the Pi

The admin app runs on the Raspberry Pi 4 in Docker Compose next to `cloudflared` (ADR 0002). `compose.yaml` at the repo root defines both. No ports are published: `cloudflared` dials out to Cloudflare, and the admin app is reachable only from `cloudflared` on the Compose network. Cloudflare Access signs the Owner in, and the admin app also rejects any request without a valid `Cf-Access-Jwt-Assertion` header, so reaching it some other way gets nothing.

These steps need a human. They assume the Profile Domain and the Cloudflare account from issue #3 exist.

## 1. Pick the admin hostname

Use a subdomain that is hard to guess, such as `stash.<profile domain>`. Scanners try `admin`, `login`, `dash` and similar names first. Don't use the Profile Domain itself, which only receives mail.

The Owner chose a subdomain of the Profile Domain over a separate domain. The trade-off: anyone who finds the hostname sees a Cloudflare Access sign-in page on the Profile Domain, which hints that an admin app exists. Cloudflare's Universal SSL certificate covers `*.<profile domain>`, so a one-level subdomain isn't published in certificate transparency logs, but don't order a separate certificate for it. A domain the Owner already has in the same Cloudflare account avoids the hint entirely.

## 2. Create the tunnel

1. In Zero Trust, go to **Networks > Tunnels** and create a `cloudflared` tunnel named `private-profile`. Activate the Zero Trust Free plan first if asked, and keep the team name bland: it shows on the sign-in page.
2. Pick **Docker** as the environment and copy the token after `--token` from the install command. Don't run that command; Compose runs `cloudflared`. The environment choice only changes the instructions shown.
3. If **Continue** stays greyed out, go back to **Tunnels**: the tunnel already exists once it's named.
4. Open the tunnel, go to **Routes**, and add a **Published application** route: the admin hostname from step 1, service URL `http://admin:8080`. Cloudflare creates the DNS record.

## 3. Create the Access application

1. In Zero Trust, go to **Access > Applications** and add a **Self-hosted** application for the admin hostname.
2. Add one **Allow** policy whose only rule is **Emails** equal to the Owner's email.
3. Copy the **Application Audience (AUD) tag** from the application's settings.
4. Note the team domain, `<team-name>.cloudflareaccess.com`, under **Account details** on the Zero Trust overview.

`scripts/setup-cloudflare.sh` walks through steps 1 to 3 and saves the settings to `deploy/admin.env`.

## 4. Put the settings and secrets on the Pi

They live in `/etc/private-profile`, outside git. The source of truth for both tokens is the Owner's password manager.

```sh
sudo install -d -m 750 -o root -g "$USER" /etc/private-profile
# deploy/admin.env from the wizard, copied over with scp, or filled in from deploy/admin.env.example
sudo install -m 444 /tmp/admin.env /etc/private-profile/admin.env && rm /tmp/admin.env
sudoedit /etc/private-profile/tunnel-token           # the token from step 2
sudoedit /etc/private-profile/cloudflare-api-token   # the KV token from issue #3
sudo chmod 444 /etc/private-profile/*
```

Only root and the user who runs `docker compose` can open the directory: Compose reads `admin.env` as that user. That user is in the `docker` group, which is root-equivalent anyway. The files themselves must stay readable by any user (`444`): Compose mounts them into containers that run as non-root users (`node` and `cloudflared`'s `nonroot`), which can't read a `400` file owned by root.

To keep them somewhere else, set `PRIVATE_PROFILE_CONFIG` to that directory when running Compose.

## 5. Get the code

The repo is private, so the Pi clones it with a read-only deploy key that can't push:

```sh
ssh-keygen -t ed25519 -N '' -C 'private-profile deploy key' -f ~/.ssh/private_profile_deploy
cat ~/.ssh/private_profile_deploy.pub   # add on GitHub: Settings > Deploy keys, write access off
printf 'Host github.com\n  HostName github.com\n  IdentityFile ~/.ssh/private_profile_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone -b develop git@github.com:jaiten-made/private-profile.git ~/private-profile
cd ~/private-profile
```

Deploy from `main` once a release has been cut.

## 6. Start it

```sh
sudo systemctl enable --now docker
docker compose up -d --build
docker compose logs -f
```

The admin app logs `Admin app listening on port 8080`, and `cloudflared` logs registered tunnel connections. Both services have `restart: unless-stopped`, so with Docker enabled at boot they come back after a reboot.

The Profile database is in the `private-profile_admin-data` volume, at `/data/profiles.db` inside the admin container.

To update: `git pull`, then `docker compose up -d --build`.

## 7. Check the acceptance criteria (issue #8)

- **Admin hostname is hard to guess.** The tunnel's only route is the admin hostname from step 1, and nothing on the bare Profile Domain points at the tunnel.
- **No inbound ports.** `docker compose ps` shows no published ports, `sudo ss -tlnp` on the Pi shows nothing new listening on a public interface, and the router has no port forwards to the Pi.
- **Sign in from away from home.** On a phone with Wi-Fi off, open the admin hostname, sign in with the Owner's email, create a Profile, and send it mail from another account. It arrives in the Personal Inbox (this needs the Email Worker from issue #3).
- **Requests without a valid Access JWT are rejected.** On the Pi, both of these print `401`:

  ```sh
  docker compose exec admin node -e 'fetch("http://localhost:8080/").then(r => console.log(r.status))'
  docker compose exec admin node -e 'fetch("http://localhost:8080/", { headers: { "Cf-Access-Jwt-Assertion": "forged" } }).then(r => console.log(r.status))'
  ```

  Signing in through the admin hostname loads the page, so the AUD tag and team domain are right.
- **Restarts after a reboot.** `sudo reboot`, then `docker compose ps` shows both services running and the admin hostname loads.

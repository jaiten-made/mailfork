# Running the admin app on the Pi

The admin app runs on the Raspberry Pi 4 in Docker Compose next to `cloudflared` (ADR 0002). `compose.yaml` at the repo root defines both. No ports are published: `cloudflared` dials out to Cloudflare, and the admin app is reachable only from `cloudflared` on the Compose network. Cloudflare Access signs the Owner in, and the admin app also rejects any request without a valid `Cf-Access-Jwt-Assertion` header, so reaching it some other way gets nothing.

These steps need a human. They assume the Profile Domain and the Cloudflare account from issue #3 exist.

## 1. Pick the admin hostname

Use a domain the Owner already has, on Cloudflare in the same account, that is **not the Profile Domain**, such as `admin.owner-domain.example`. Nothing on the Profile Domain may point at the tunnel, so it never hints that an admin app exists.

## 2. Create the tunnel

1. In Zero Trust, go to **Networks > Tunnels** and create a `cloudflared` tunnel named `private-profile`.
2. Copy the tunnel token from the install command. Don't run that command; Compose runs `cloudflared`.
3. Add a public hostname: the admin hostname from step 1, service `HTTP`, URL `admin:8080`. Cloudflare creates the DNS record on the admin domain.

## 3. Create the Access application

1. In Zero Trust, go to **Access > Applications** and add a **Self-hosted** application for the admin hostname.
2. Add one **Allow** policy whose only rule is **Emails** equal to the Owner's email.
3. Copy the **Application Audience (AUD) tag** from the application's settings.
4. Note the team domain, `<team-name>.cloudflareaccess.com`, from the Zero Trust settings.

## 4. Put the settings and secrets on the Pi

They live in `/etc/private-profile`, outside git. The source of truth for both tokens is the Owner's password manager.

```sh
sudo install -d -m 700 /etc/private-profile
sudo cp deploy/admin.env.example /etc/private-profile/admin.env
sudoedit /etc/private-profile/admin.env   # Profile Domain, Access team domain and AUD, KV ids
sudoedit /etc/private-profile/tunnel-token           # the token from step 2
sudoedit /etc/private-profile/cloudflare-api-token   # the KV token from issue #3
sudo chmod 444 /etc/private-profile/*
```

The directory is root-only, so nobody else on the Pi can read the files. The files themselves must stay readable by any user (`444`): Compose mounts them into containers that run as non-root users (`node` and `cloudflared`'s `nonroot`), which can't read a `400` file owned by root.

To keep them somewhere else, set `PRIVATE_PROFILE_CONFIG` to that directory when running Compose.

## 5. Start it

```sh
sudo systemctl enable --now docker
docker compose up -d --build
docker compose logs -f
```

The admin app logs `Admin app listening on port 8080`, and `cloudflared` logs registered tunnel connections. Both services have `restart: unless-stopped`, so with Docker enabled at boot they come back after a reboot.

The Profile database is in the `private-profile_admin-data` volume, at `/data/profiles.db` inside the admin container.

To update: `git pull`, then `docker compose up -d --build`.

## 6. Check the acceptance criteria (issue #8)

- **Admin hostname isn't on the Profile Domain.** In the Profile Domain's DNS, no record points at the tunnel (a CNAME to `<tunnel-id>.cfargotunnel.com`). The tunnel's only public hostname is on the admin domain.
- **No inbound ports.** `docker compose ps` shows no published ports, `sudo ss -tlnp` on the Pi shows nothing new listening on a public interface, and the router has no port forwards to the Pi.
- **Sign in from away from home.** On a phone with Wi-Fi off, open the admin hostname, sign in with the Owner's email, create a Profile, and send it mail from another account. It arrives in the Personal Inbox (this needs the Email Worker from issue #3).
- **Requests without a valid Access JWT are rejected.** On the Pi, both of these print `401`:

  ```sh
  docker compose exec admin node -e 'fetch("http://localhost:8080/").then(r => console.log(r.status))'
  docker compose exec admin node -e 'fetch("http://localhost:8080/", { headers: { "Cf-Access-Jwt-Assertion": "forged" } }).then(r => console.log(r.status))'
  ```

  Signing in through the admin hostname loads the page, so the AUD tag and team domain are right.
- **Restarts after a reboot.** `sudo reboot`, then `docker compose ps` shows both services running and the admin hostname loads.

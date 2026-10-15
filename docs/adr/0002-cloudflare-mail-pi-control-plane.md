# Cloudflare handles mail, a home Raspberry Pi runs everything else

The brief asked for GCP, but GCP can't receive mail on a custom domain. Cloudflare Email Routing receives all mail for the Profile Domain, and an Email Worker forwards or rejects each message by checking a list of live Profile Addresses in Workers KV. A Raspberry Pi 4 at home holds the Profiles, runs the admin app, and pushes the live-address list to KV whenever it changes. It is reachable only through Cloudflare Tunnel, with sign-in through Cloudflare Access. The Worker never calls the Pi, so mail keeps flowing when the Pi is down; only Profile management stops.

## Considered Options

- **GCP alone**: has no inbound mail service for custom domains.
- **AWS (SES, Lambda, DynamoDB)**: works and costs about $2 to $4 a month for personal volume, but we'd have to write the forwarding MIME rewriting (DMARC-safe `From`, `Reply-To`) ourselves.
- **Postfix on the Pi**: needs inbound port 25 and a public IPv4 address, which home connections often lack (CGNAT or blocked ports). Forwarding from a residential IP is unreliable. And the MX record would publish the Owner's home IP, linking every Profile to one house.

## Consequences

- We're locked into Cloudflare for mail, DNS for the Profile Domain, the tunnel and sign-in.
- Forwarded mail can only go to Personal Inbox addresses that have been verified in Cloudflare Email Routing.

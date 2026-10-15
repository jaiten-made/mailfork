# Forward Profile mail to the Personal Inbox instead of storing it

The product is modelled on MySudo, where each Profile has its own inbox inside the app. For the MVP we deliberately don't store mail: everything sent to a Profile Address is forwarded to the Owner's Personal Inbox. Building storage, MIME parsing and a reader UI is most of the work, and forwarding solves the core problem (signing up without exposing the real address) without any of it.

## Consequences

- The Profiles aren't separate from the Personal Inbox's provider: it sees every Profile's mail in one place.
- Replies, auto-responders, `mailto:` unsubscribes and calendar RSVPs sent from the Personal Inbox leak the real address. We had planned to set `Reply-To` to a sink address, but Cloudflare's `forward()` only allows adding `X-` headers, so forwarded mail keeps the original `From` and `Reply-To`. For the MVP we accept this: a Gmail filter on `to:(@<profile domain>)` labels Profile mail so it stands out, and the Owner doesn't reply from the Personal Inbox. The planned "reply as Profile" feature is the real fix. Rebuilding each message in the Worker was rejected: it needs Workers Paid, is limited to 5 MiB per message, and means writing our own MIME handling.
- Forwarding is meant to become something that can be switched off once in-app storage exists. It is not the permanent design.

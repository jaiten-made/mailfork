# Private Profile

Lets one person hold several separate identities (Profiles), each with its own email address, so the services they deal with can't link those identities to each other or to the person.

## Language

**Owner**:
The person who holds Profiles. Each deployment has exactly one Owner, who runs it and holds its Profiles, and every Profile belongs to that Owner.
_Avoid_: User, account, customer

**Profile**:
A separate identity belonging to an Owner, made up of a Label and exactly one Profile Address.
_Avoid_: Persona, alias, Sudo, identity

**Label**:
The Owner-facing name of a Profile, such as "Shopping" or "Dating". Only the Owner ever sees it.
_Avoid_: Name, title

**Profile Address**:
The email address that belongs to a Profile, on the Profile Domain. It is unique for all time: no two Profiles, past or present, ever share one.
_Avoid_: Alias, email, mailbox

**Generated Address**:
A Profile Address made by the system in a random but readable form, such as `quiet.otter.42`. This is the default.

**Custom Address**:
A Profile Address whose local part the Owner chose instead of accepting a Generated Address.

**Profile Domain**:
The domain set aside for Profile Addresses. It is used for nothing else.

**System Address**:
An address on the Profile Domain that every mail domain is expected to have, such as `postmaster@` and `abuse@`. It forwards to the Owner and never belongs to a Profile.
_Avoid_: Admin alias, role account

**Personal Inbox**:
The Owner's own, real mailbox, kept outside the system. Its address must never be revealed to anyone who mails a Profile.
_Avoid_: Real email, main email, destination

**Forwarding**:
Delivering mail sent to a Profile Address by passing a copy on to the Personal Inbox.
_Avoid_: Relay, redirect

**Backup**:
An encrypted copy of every Profile, live and Retired, kept away from the server so the Profiles survive losing it. Mail is never part of a Backup, because mail is never stored.
_Avoid_: Snapshot, export, dump

**Retire**:
What happens to a Profile Address when its Profile is deleted: it stops accepting mail and can never be issued again.
_Avoid_: Delete address, burn, recycle

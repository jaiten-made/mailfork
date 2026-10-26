# Product

<!-- impeccable:product-schema 1 -->

Inferred from the repository (issue #1, GLOSSARY.md, docs/adr) without an interview round: no answer mechanism was available when this was written. Every fact below is labelled _(inferred)_ until the Owner confirms it.

## Platform

web

## Users

One Owner _(inferred)_: the only person who signs in. They usually reach the admin app on their phone, partway through signing up to some service, wanting a fresh Profile Address to paste into the signup form within seconds. Less often they come back at a desk to check which Profile is used where.

## Product Purpose

Private Profile lets the Owner hold separate Profiles, each with its own Profile Address on a dedicated Profile Domain, so services can't link those Profiles to each other or to the Owner. Mail to a live Profile Address is forwarded to the Personal Inbox. The admin app is where Profiles are created, listed, renamed and (later) Retired. Success: a new, working address is copied into a signup form in under ten seconds.

## Positioning

Unlike hosted forwarding services, the Profiles live only on the Owner's own server; Cloudflare only learns which addresses exist and whether they are live (ADR 0002, docs/kv-address-list.md).

## Operating Context

- Reached only through Cloudflare Tunnel and Cloudflare Access, signed in as the Owner.
- Mostly used on a phone, one-handed, in the middle of another site's signup flow _(inferred)_.
- Workers KV is eventually consistent: a new or Retired address takes up to about a minute to take effect.

## Capabilities and Constraints

- Create a Profile from a Label, getting a Generated Address (`adjective.noun.NN`) or, optionally, a Custom Address checked as the Owner types.
- List live Profiles with Label, Profile Address and created-at; rename a Label; copy an address with one tap.
- Terminology is fixed by GLOSSARY.md: Owner, Profile, Label, Profile Address, Generated Address, Retire. Avoid "alias", "persona", "account", "name".
- Small surface served by the Node admin app as static HTML, CSS and vanilla JS on its JSON API. No external fonts, scripts or trackers.

## Brand Commitments

None yet.

## Evidence on Hand

No real Profiles, screenshots or assets. Fixtures use `example` domains, such as `quiet.otter.42@profile.example`.

## Product Principles

1. Seconds to a working address: the create path beats everything else on the page.
2. Never reveal more than needed: Labels and the Personal Inbox stay on the server.
3. Be honest about timing: say when an address is not working yet.

## Accessibility & Inclusion

No product-specific requirement established; meet WCAG 2.2 AA as a floor _(inferred)_.

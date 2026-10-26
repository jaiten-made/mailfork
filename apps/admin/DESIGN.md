---
name: MailFork admin
description: A bank of private boxes on the Owner's own premises, one door per Profile.
colors:
  wall: "#c5cad0"
  door: "#e7eaed"
  door-edge: "#969da6"
  door-shine: "rgb(255 255 255 / 0.75)"
  frame: "#a9b0b8"
  field: "#f4f5f7"
  field-edge: "#737a84"
  counter-field: "#f4f5f7"
  counter-ink: "#15171b"
  counter-placeholder: "#5c636d"
  counter-caret: "#962311"
  counter-button: "#c5cad0"
  counter-button-hover: "#dde1e5"
  counter-seam: "#000000"
  enamel: "#16181c"
  on-enamel: "#eef0f2"
  on-enamel-soft: "#aab1ba"
  plate: "#16181c"
  ink: "#15171b"
  ink-soft: "#464c55"
  flag: "#962311"
  flag-bright: "#e2452a"
  flag-tint: "#f6ddd6"
  on-flag: "#fff7f5"
  on-enamel-error: "#ff8f78"
  ok: "#276747"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 8vw, 2.75rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.5
  title:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
  plate:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.05em"
  address:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: 1.3
  door-label:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  mono:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "1rem"
    fontWeight: 400
rounded:
  door: "6px"
  plate: "3px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  bank: "40px"
components:
  button:
    backgroundColor: "{colors.door}"
    textColor: "{colors.ink}"
    rounded: "{rounded.door}"
    padding: "0 16px"
    height: "44px"
  button-ink:
    backgroundColor: "{colors.enamel}"
    textColor: "{colors.on-enamel}"
    rounded: "{rounded.door}"
    padding: "0 16px"
    height: "44px"
  button-flag:
    backgroundColor: "{colors.flag}"
    textColor: "{colors.on-flag}"
    rounded: "{rounded.door}"
    padding: "0 16px"
    height: "44px"
  button-quiet:
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    padding: "0 4px"
    height: "44px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.door}"
    padding: "0 12px"
    height: "44px"
  create-field:
    backgroundColor: "{colors.counter-field}"
    textColor: "{colors.counter-ink}"
    rounded: "{rounded.door}"
    padding: "0 14px"
    height: "52px"
  create-submit:
    backgroundColor: "{colors.counter-button}"
    textColor: "{colors.counter-ink}"
    rounded: "{rounded.door}"
    padding: "0 22px"
    height: "52px"
  create-submit-hover:
    backgroundColor: "{colors.counter-button-hover}"
    textColor: "{colors.counter-ink}"
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.on-enamel}"
    typography: "{typography.plate}"
    rounded: "{rounded.plate}"
    padding: "2px 9px"
    width: "3.5rem"
  door:
    backgroundColor: "{colors.door}"
    textColor: "{colors.ink}"
    rounded: "{rounded.door}"
    padding: "12px 14px 2px"
  counter:
    backgroundColor: "{colors.enamel}"
    textColor: "{colors.on-enamel}"
    padding: "20px 16px 22px"
  alert:
    backgroundColor: "{colors.flag-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.door}"
    padding: "20px 16px 16px"
---

# Design System: MailFork admin

## Overview

**Creative North Star: "The Private Bag Wall"**

The admin page is a bank of private boxes on the Owner's own premises. The ground is anodised aluminium; a black enamel counter runs across the top where boxes are issued; below it the wall of doors, each an aluminium panel with a one-pixel edge, a bright top highlight, a black enamel numeral plate, a letter slot, and the Profile Address engraved large in a condensed industrial face. It is hardware, not a dashboard: the doors share seams inside one framed bank rather than floating as separate cards.

Density is high but legible: one door holds number, Label, address, Copy, date and two quiet actions, so state reads at a glance on a phone held in one hand. Colour is almost entirely neutral metal. Vermilion is the mail flag and only appears when something needs the Owner. Green appears only when something is done. At night the wall turns black anodised (dark scheme), with the same structure and the flag brightened.

The system refuses the neutral SaaS card list and the hacker terminal.

**Key Characteristics:**
- Aluminium ground, black enamel counter and numeral plates, aluminium doors.
- Doors packed into one framed bank with one-pixel seams, stacked on a phone, a grid on desktop.
- Barlow Semi Condensed for the engraved parts (numerals, addresses, Labels, headings); system sans for everything read as prose.
- Vermilion as a raised mail flag, never as decoration.
- Retired doors are sealed: dashed, struck through, hatched slot, never hidden.

## Colors

Cool, low-chroma aluminium greys and black enamel, with one vermilion signal and one green confirmation.

### Primary
- **Black Enamel** (`enamel`): the counter header, primary in-door actions (Save), text selection, and form accent colour. It marks where things are issued and committed.
- **Plate Enamel** (`plate`): the numeral plates on every live door. Identical to Black Enamel in light; deeper than it in dark so plates still read against the dark counter and doors.

### Secondary
- **Mail Flag Vermilion** (`flag`): the needs-the-Owner signal, and the error text colour off the counter. Error messages; alert border, icon and hatch; the Retire confirm button; the invalid-field ring in the Retire form; the Retire link on hover; the text caret.
- **Raised Flag** (`flag-bright`): graphics only, never text. The flag cloth on the issued door and the one-minute timer strip under it.
- **Flag Tint** (`flag-tint`): the background of the alert.
- **On Flag** (`on-flag`): text on a vermilion button.
- **Enamel Error** (`on-enamel-error`): error text and invalid ring on the black counter, where the base vermilion would be too dark.

### Tertiary
- **Done Green** (`ok`): the Copy button border and text in its copied state. Nothing else.

### Neutral
- **Anodised Wall** (`wall`): page ground, the Retired bank's fill, and the light Create button on the counter.
- **Aluminium Door** (`door`): door panels, default buttons, the notice panel.
- **Door Edge** (`door-edge`): one-pixel edges on doors, banks and panels, the rules between door parts, the lowered flag, and the hatch on a sealed slot.
- **Field Edge** (`field-edge`): one-pixel borders on buttons and fields, dark enough to meet the 3:1 non-text minimum against door and field fills.
- **Door Shine** (`door-shine`): the one-pixel inset top highlight on doors and default buttons.
- **Frame** (`frame`): the seam colour drawn between doors inside a bank.
- **Field** (`field`): text input fill.
- **Ink** (`ink`) and **Soft Ink** (`ink-soft`): primary text; secondary text, the domain half of an address, dates, counts, quiet actions, sealed doors.
- **On Enamel** (`on-enamel`) and **Soft On Enamel** (`on-enamel-soft`): text on the counter; hints and the disclosure link on the counter.

### Counter
The counter is black enamel in both schemes, so its controls keep light aluminium values in dark mode too.
- **Counter Field** (`counter-field`), **Counter Ink** (`counter-ink`), **Counter Placeholder** (`counter-placeholder`), **Counter Caret** (`counter-caret`): the Label field and its text, placeholder and caret.
- **Counter Button** (`counter-button`) and **Counter Button Hover** (`counter-button-hover`): the Create button at rest and on hover.
- **Counter Seam** (`counter-seam`): the black line under the counter.

Dark scheme ("black anodised", `prefers-color-scheme: dark`) remaps the same tokens: wall `#111316`, door `#1e2126`, door-edge `#3a3f47`, field-edge `#6b727c`, door-shine `rgb(255 255 255 / 0.07)`, enamel `#1c1f24`, plate `#08090b`, frame `#2c3037`, field `#24282e`, ink `#e9ecef`, ink-soft `#a5acb6`, flag `#ff7458`, flag-bright `#ff6a4d`, flag-tint `#3a1d17`, on-flag `#1a0b07`, ok `#74d3a1`. On Enamel, Soft On Enamel, Enamel Error and the counter tokens do not change.

### Named Rules
**The Mail Flag Rule.** Vermilion means something needs the Owner now: an address in its first minute, an address list out of sync, a failed Backup, an irreversible Retire. It is never a brand accent, a primary action colour, or decoration. The Create button is aluminium, not vermilion.

**The Green Means Done Rule.** Green appears only on a finished action (copied). It is never a status badge or a decorative success colour.

## Typography

**Display Font:** Barlow Semi Condensed, self-hosted at 600 and 800 (OFL), with system-ui fallback
**Body Font:** system-ui stack
**Label/Mono Font:** ui-monospace stack, only for typing an address to confirm Retire

**Character:** A condensed, bold industrial face for everything that would be stamped or engraved on the hardware, set against the device's own sans for anything read as a sentence. Numerals are tabular everywhere.

### Hierarchy
- **Display** (800, clamp 1.875rem to 2.75rem, 1.05): the just-issued address, at reading-out size. Only one per page.
- **Headline** (650, 1.5rem): the Label field's label on the counter, which doubles as the page's visible heading.
- **Title** (700, 1.25rem, 1.2): bank headings (Live Profiles, Retired Profiles), with the count in Soft Ink at 500.
- **Plate** (800, 1.25rem, 1.2, letter-spacing 0.05em): the three-digit box number, zero-padded, centred on enamel.
- **Address** (600, 1.1875rem, 1.3): a door's Profile Address; the `@domain` half set in Soft Ink.
- **Door Label** (650, 1.125rem; 1.25rem on the issued door): the Profile's Label beside the plate.
- **Body** (400, 1rem, 1.5, tabular numerals): notices, warnings, hints, kept to 60ch.
- **Label** (400, 0.875rem): created and retired dates, quiet actions, reconcile status.

### Named Rules
**The Engraved Parts Rule.** Barlow Semi Condensed is for what would be engraved or enamelled on the box: numerals, addresses, Labels, bank headings. Sentences, buttons and hints stay in the system sans.

**The Read It Out Rule.** The domain half of an address is set quieter (Soft Ink) for scanning, except where the whole address must be typed or read out (Retire confirmation, the post-Retire notice), where it takes full ink.

## Layout

A single centred column, max width 72rem plus gutters, with 16px gutters on a phone and 24px from 560px. The counter is full bleed; its form is capped at 36rem so the Label field and Create sit at thumb height. Banks are separated by 40px; the wall pads 20px top and 48px bottom on a phone, 28px and 56px from 560px.

Inside a bank the doors stack in one column on a phone and from 760px fill a grid of `repeat(auto-fill, minmax(26rem, 1fr))`. The Retired bank is always one column so it never shows an empty bay. The just-issued door heads the live bank, joined to it with squared corners where they meet; on a phone its Copy button spans the full width, and from 560px it sits beside the address.

Spacing steps observed: 4, 8, 12, 16, 24 and 40px. Every interactive target is at least 44px tall; the counter's field and Create are 52px.

## Elevation & Depth

Depth is physical hardware, not floating UI. Surfaces carry one short, tight drop shadow plus a one-pixel inset top highlight that reads as light catching a metal edge. Inset shadows make recesses (the letter slot). Nothing floats with a large ambient blur.

### Shadow Vocabulary
- **Hardware** (`box-shadow: 0 1px 1px rgb(21 23 27 / 0.14), 0 2px 4px -1px rgb(21 23 27 / 0.18)`; dark: `0 1px 1px rgb(0 0 0 / 0.5), 0 2px 4px -1px rgb(0 0 0 / 0.6)`): a framed bank, a standalone door, the issued door.
- **Top Shine** (`box-shadow: inset 0 1px 0 var(--door-shine)`): every door and default button.
- **Seam** (`box-shadow: 1px 1px 0 var(--frame)`): each door inside a bank draws its right and bottom seam; the bank's frame clips the outer ones.
- **Slot Recess** (`box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.6), 0 1px 0 var(--door-shine)`): the letter slot.
- **Counter Ledge** (`box-shadow: 0 1px 0 var(--door-shine), 0 2px 6px -2px rgb(0 0 0 / 0.4)`): the lip under the enamel counter.

### Named Rules
**The One-Pixel Seam Rule.** Doors inside a bank touch. No gaps, no individual radii, no individual drop shadows: the bank owns the frame, radius and Hardware shadow, and the seams between doors are one pixel of Frame.

**The Sealed Is Flat Rule.** Retired surfaces lose all shadow and shine: dashed edge, wall-coloured fill.

## Shapes

Gently radiused metal (6px) on doors, banks, buttons, fields and panels; tighter 3px on enamel plates and the slot. Borders are always one pixel. A dashed border means sealed (Retired). The recurring silhouette is the door head: plate at left, Label beside it, a 30 by 5px black letter slot pushed to the top right. A -45 degree hatch is the non-colour state mark: on the alert's top strip (out of sync) and in a sealed door's slot (Retired).

## Components

### Buttons
Solid, tactile hardware switches.
- **Shape:** gently radiused (6px), one-pixel border, 44px minimum height, 600 weight, icon gap 8px.
- **Default:** aluminium door fill, Field Edge border, Top Shine. Hover darkens the border to Soft Ink.
- **Ink:** Black Enamel fill and border, On Enamel text, no shine; hover mixes 15% door into the enamel. For committing an in-door edit (Save).
- **Flag:** vermilion fill, On Flag text; hover mixes 15% enamel in. Only for the irreversible Retire confirmation.
- **Quiet:** borderless underlined text in Soft Ink at 0.875rem, 1px underline offset 3px, still 44px tall. Hover goes to Ink; Retire goes to vermilion on hover.
- **Copy:** a default button with an 18px copy icon; copied state turns border and text Done Green. On the issued door it grows to 52px and 1.0625rem.
- **Disabled:** 60% opacity, progress cursor.
- **Focus:** 2px solid Ink outline, offset 2px; On Enamel on the counter.

### Inputs / Fields
- **Style:** Field fill, one-pixel Field Edge border, 6px radius, 44px tall, 12px horizontal padding.
- **Counter field:** borderless Counter Field at 52px, 1.0625rem, with Counter Ink text and a vermilion Counter Caret, beside the Counter Button (Create), both light on enamel in either scheme.
- **Invalid:** border plus a 1px ring in vermilion (Enamel Error on the counter), with `aria-invalid`.
- **Confirmation:** the Retire confirmation field is set in mono.

### Cards / Containers
- **Bank:** one framed panel of doors (see The One-Pixel Seam Rule), 6px radius, Hardware shadow, overflow clipped.
- **Notice:** aluminium panel with Door Edge border, 12px 16px padding, for after-the-fact facts (post-Retire).
- **Alert:** Flag Tint panel with vermilion border, a 6px vermilion hatch strip across the top and a 24px flag icon. For an out-of-sync address list or a failed Backup only.

### Navigation
None. The page is one surface: counter, live bank, retired bank, and a quiet reconcile link at the foot.

### The Door (signature)
Plate, Label and slot in the head; the address with Copy beside it; a foot with the created date and quiet Rename and Retire, separated by a half-strength Door Edge rule. Rename replaces the Label in the head; Retire opens a typed confirmation under the foot, bordered off and warned in Soft Ink.

### The Issued Door (signature)
The door just created, at the top of the live bank: address at Display size, a 52px Raised Flag icon on the right edge, the slot moved in to make room, and a status panel saying the address may take a minute. A 3px Raised Flag strip runs out along the bottom over 60 seconds, then the flag rotates 90 degrees down to Door Edge grey and the text goes to Soft Ink. With motion allowed, the door slides 16px out from under the counter while unclipping (420ms), and the flag raises 300ms later (360ms), all on `cubic-bezier(0.16, 1, 0.3, 1)`.

### The Sealed Door
A Retired Profile: dashed edge, wall fill, outlined plate in Soft Ink, hatched slot, address struck through, created and retired dates side by side. Nothing to copy.

## Do's and Don'ts

### Do:
- **Do** border buttons and fields with Field Edge and doors with Door Edge.
- **Do** pack doors into one framed bank with one-pixel Frame seams; give the bank, not the door, the radius and Hardware shadow.
- **Do** put a numeral plate (zero-padded to three digits) and a letter slot on every door.
- **Do** raise vermilion only when the Owner must act or wait, and pair it with a non-colour mark (flag shape, hatch, text).
- **Do** keep every interactive target at least 44px tall and Copy within thumb reach.
- **Do** gate every movement behind `prefers-reduced-motion: no-preference`, using the 0.16, 1, 0.3, 1 ease-out.
- **Do** define both schemes through the same custom properties; build new surfaces on `var(--token)`, not literals. Hex values live only in `:root`.

### Don't:
- **Don't** use vermilion for primary actions, headings, or decoration.
- **Don't** set text in Raised Flag; it is for the flag cloth and timer only. Error text uses Mail Flag Vermilion.
- **Don't** use green for anything but a finished action.
- **Don't** separate doors into floating cards with gaps and their own shadows; that is the neutral SaaS card list this world refuses.
- **Don't** reach for terminal styling (green on black, monospace addresses); mono is only for typing an address back.
- **Don't** set prose, buttons or hints in Barlow Semi Condensed.
- **Don't** hide Retired Profiles; seal them.
- **Don't** add large blurred ambient shadows or glassy translucency; depth is a metal edge and a short drop.

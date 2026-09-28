# UNIFICATION — how all House efforts stay one project

Canonical rule for the unified House work (the app, the drawings, the search,
the build). Set by Daniel on **2026-09-28**. Part of the operating contract:
`CLAUDE.md` and `AGENTS.md` point here. Written for a non-coder — plain language,
on purpose.

## Why this exists

The House lives in more than one place at once: this app (software), the
Hearthtree / Treehearth **drawings** done straight through AI (Blender models,
renders, a big design gallery), the **house search**, and the eventual build.
After a hard-drive crash and with work happening in different environments, the
real risk is two efforts quietly contradicting each other — a newer file erasing
an older intention, or one environment rebuilding what another already settled.
This rule keeps them one project.

## THE RULE

> **The latest binding design supersedes the earlier ones. Nothing is deleted —
> everything is retained for history and later archaeology.**

### The one sharpening (from Daniel's own 10 Sep 2026 review)

"Latest" means the latest **decision**, not merely the most recently-touched
**file**. A newer form study once *lost* room and circulation intent that an
older hand-marked drawing still held. So:

- An earlier drawing stays a **live source for a detail** until a later decision
  **explicitly** replaces that detail.
- A recent render does **not** silently override an older intention just because
  it carries a later timestamp. Supersede on purpose, never by accident.

## ORDER OF AUTHORITY

When two sources disagree, the higher one wins — but only where it actually
speaks; it does not erase detail it is silent about.

1. **Daniel's most recent explicit decision.** Binding. (e.g. forward southeast
   tower · full usable deck ring · two enclosed main-level bedrooms · H01
   rejected.)
2. **The app's current model** — the working geometry the drawings cite
   (e.g. the deck-ring revision). The software's live source of truth.
3. **Earlier drawings & studies** — mined for detail; superseded only by 1 or 2.
4. **Everything else** — every prior version, render, sketch and note. Retained,
   dated, searchable. **Never deleted.**

## TWO SOURCES OF TRUTH (keep them straight)

- **The software** → **this repo** (`HOUSE-DESIGN-APP`, `main`). The code.
- **The house design** → **Google Drive + Photion + local `design-archive/`**.
  The decisions, drawings, renders, models, the design gallery.

Neither silently overwrites the other. The app may *hold* geometry the design
track cites, and the design track may *decide* what the app should model — but a
change on one side becomes canonical on the other only by an explicit step,
never by a background sync.

## WHERE THINGS LIVE (as of 2026-09-28)

- **App code:** this repo, `main`, update 250. (A cloud checkout has the code but
  **not** Daniel's live design data — that sits in the app's local `.data/` on
  his machine.)
- **Latest drawings:** the **Hearthtree** set in Google Drive (H01 review,
  furnished spatial study, fresh renders, updated construction-drawings deck,
  `House-and-App-Development-Map.html`), content dated **Sep 9–15 2026**,
  re-copied to Drive **Sep 27–28** after the crash. Local canonical home:
  `C:\Users\danir\HOUSE-DESIGN-APP\design-archive\Hearthtree-Source-Context-2026-09-10\`.
- **In this repo's `design-archive/`:** only a **July** snapshot (the older
  Treehearth pptx, the FreeCAD `house_design_studio`, prototypes). The September
  Hearthtree work is **not yet committed here** — its GitHub publication was held
  pending Daniel's approval (the repo is public).
- **House search:** Photion `PRJ-34` + the Home Search Console artifact.
- **Project state:** Photion — `PRJ-911` (the app), `PRJ-34` (the search).

## OPEN DECISION (Daniel's call)

Whether to commit the September **Hearthtree** design track into this **public**
repo (Law #1 "one place" says it belongs here; it was held back pending
approval). Until decided, Drive + local remain its canonical home and this rule
still governs across all of them.

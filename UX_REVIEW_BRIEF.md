# UX Deep-Review Brief — Natural Building design app

You are a senior UX designer doing a deep, honest review of a working app. Your job is to
FIND problems and rank them — not to implement fixes, not to flatter. Assume the builder
will act on every finding, so each one must be specific enough to act on.

## What the app is

A home-design studio for natural building (straw bale, cob, timber) that keeps a REAL
building model behind everything: live cost, sweat-equity, carbon, code checks, permit
drawings, IFC export. Three columns: controls on the left (organized by building system),
the 3D/2D model in the center, an AI chat on the right. Users design by system pages,
by dragging in a 2D plan, by tapping parts of the 3D model, or by asking the chat —
including tracing a whole design from an uploaded PDF floor plan.

Run it: `npm install` once, then `node server.mjs` from the repo root, and open
http://127.0.0.1:5184/ (or review the running instance if one is up). Drive it like a
real user: start a design from scratch, trace the sample PDF if provided, drag rooms,
tap walls, change numbers.

## Who it is for — this rules everything

The owner and every intended user are TOTAL NON-CODERS and non-architects. A homesteader
planning a straw-bale house, and a friend they share the app with. That means:
- Plain language everywhere. Any label a builder's client wouldn't say out loud is a bug.
- One-click workflows. Anything that needs explanation is a finding.
- The measuring stick for MVP: **a new user's first hour produces zero
  "wait, why can't I—" moments.** Review AS that first-hour user.

## The owner's standing laws (violations of these are your highest-severity findings)

1. **Don't break anything > everything works > beauty.** Function outranks polish.
2. **"EVERYTHING it needs, NOTHING it doesn't."** Maximal minimalism without losing
   capability. Redundant surfaces, duplicate paths to the same action, and expert chrome
   are all findings.
3. **One editor per thing.** The left panel designs by SYSTEM (walls, roof, water…);
   the docked Inspector is the SINGLE per-object editor; the model and plan are selector
   surfaces. Two open surfaces editing the same parameter = confirmed past complaint,
   treat any recurrence as severe.
4. **Plain numbers first.** Every system page must lead with its 2–3 most obvious
   dimensions (height, width, length) before any specialist knob. This was a real
   complaint: "finer controls but lacks the most obvious ones."
5. **Everything grabbable, nothing mysterious.** In 3D and 2D, whatever the eye reads
   as a thing should be tappable, and what's tappable should be draggable where dragging
   makes sense. Past complaints, verbatim: "why can't I grab every part",
   "the workflow of editing in the model is painful", "cluttered with labels",
   "the very top is muddled", "I cannot reposition the storeys" (the control existed —
   DISCOVERABILITY was the failure; treat hidden-but-existing controls as failures).
6. **Numeric variables must always be workable.** Any number the user can see, they
   should be able to change, right there or one obvious step away.
7. **The left bar reads in an intelligent sequence:** identity → verdict (cost/checks
   tiles) → mode (Design|Build) → view tabs → system map (in build order: site →
   foundation → frame → floor → walls → roof → windows → services) → the system page →
   the selected-object Inspector last. General → specific, stable → transient. Audit it.
8. **Plan-first is the real workflow.** The owner arranges rooms in the 2D plan FIRST,
   then refines in 3D. The 2D plan recently earned per-floor tabs, opening drags, and a
   footprint editor — stress-test this path hard: does dragging feel solid, do things
   stay where you put them, is the second floor workable?
9. **The app must be able to do it — not a human, not luck.** Every capability should be
   reachable three ways: a UI control, a chat phrase, and (where relevant) the PDF trace.
   A capability reachable only via chat, or only via UI, is a gap worth naming.

## Journeys to walk end-to-end (report friction per step)

A. **First hour, blank start:** opening card → start on empty land → add rooms → shape
   the shell → pick wall system → roof → a window → read the cost → fix a red flag.
B. **Trace a PDF:** start from a file → watch what lands → fix what the trace missed
   (move a room, correct a dimension) → how honest is the app about what it could not
   model (warnings)?
C. **Plan-first design:** arrange all rooms in 2D → storeys: add a floor, size/position
   the upper floor, put a loft + tower stack over one bay → back to 3D to verify.
D. **The 3D as a tool:** tap everything (walls, windows, roof, frame, foundation, site);
   use Layers presets (incl. Frame raising view), the view buttons, the Slice slider,
   x-ray, explode. Is selection always visible? Does the camera behave?
E. **Design to real world:** Costs tab (DIY toggles, compare "built the other way") →
   Review flags (one-tap fixes) → Build mode (timeline, materials) → Export (permit set,
   frame drawings, IFC/Blender, brief).
F. **Second user:** the sharing story — could the friend run it from the zip/GitHub and
   survive their first hour? Read TESTING.md skeptically.

## Known scar tissue (verify these stayed fixed, and look for siblings)

- Silent failure was a plague: every click must either visibly work or visibly explain.
  Try to make actions fail (server briefly busy, weird input) — does the app confess?
- Things "not staying put" in the plan (was a trace-geometry bug, now guarded) — try to
  reproduce anyway with adversarial dragging.
- The opening card must appear on every real open/refresh, never mid-work.
- Label clutter in 3D (element labels now show only when selected — is it enough?).
- The top of the model view has fixed overlay lanes (view toggle, layers, compass,
  floor tabs, selection chip) — is it muddled at narrow widths?

## What NOT to do

- Do not propose replacing the 3D with Blender or another engine (decided; Blender is
  the export path only). Do not propose a rewrite of the three-column architecture or
  the one-editor principle — improve within them.
- Do not grade against pro-CAD conventions; grade against the non-coder first hour.
- Do not implement changes. Review only.

## Deliverable

1. **Top-10 findings**, ranked by (severity × frequency of encounter), each with:
   the journey step where it bit, what you expected as a first-hour user, what happened,
   and a concrete, minimal fix that respects the laws above.
2. **Per-journey friction log** (A–F): a short table of step → friction → severity.
3. **Law-by-law verdict** (laws 1–9): pass / partial / fail with one line of evidence.
4. **Three "delight" opportunities** — cheap changes with outsized warmth, consistent
   with the existing "warm earthen studio" visual language (paper-light model overlays,
   dark charcoal panels, Fraunces headings, clay accents). No new visual language.
5. **One page max of prose summary** in plain language the owner (a non-coder) can read
   without translation.

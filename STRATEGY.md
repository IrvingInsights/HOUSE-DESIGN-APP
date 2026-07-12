# STRATEGY — from whack-a-mole to a finished app

Written 2026-07-12 after Daniel called the pattern: piecemeal fixes, each
proven on one drawing, failing on the next. This document is the whole board
and the plan. **Every session on this app executes this plan in order and
does not freelance.** RESUME.md says where we are; this says where we're going.

## The one sentence that defines success

> Attach a drawing, press Apply, and get a decent model in the preview —
> every time, with the app itself saying how good the read was — without
> Daniel ever needing an AI assistant to check or fix it.

"Decent" is not a feeling; it is the 11 trace invariants (rooms measured,
tiled, covering the plan, inside the shell, believable openings, honest
index) plus a model that *looks* like the drawing's massing in the preview.

## The hard truth the strategy is built on

The drawing reader is a statistical AI. The same PDF gives different results
run to run, and no prompt will ever change that. Chasing each bad run with a
prompt tweak is the losing game we've been playing. The winning game is
**engineering around a fallible reader**:

1. **Referee every read** — the app scores its own traces and retries bad ones.
2. **Shrink what the AI is trusted with** — it reads *lists* (room names,
   sizes, what's next to what); deterministic code does the *placement*.
3. **Show the user the truth** — score and doubts in the UI, drawing beside
   plan, one-tap re-check.
4. **Prove stability, not single wins** — a fix counts when the whole corpus
   passes repeatedly, not when one run goes green.

## The whole board (everything that must be true, checked off or planned)

| Front | State | Verdict |
|---|---|---|
| Trace invariants + nets (11 checks, can't be gamed) | Done tonight | Keep extending when new failures appear |
| Deterministic rescues (geometry, overlap, outdoor, basement, tower, attach) | Done | Class-fix pattern is working |
| Repair loop (2 rounds) + audit loop (2 rounds) | Done | Sufficient once Phase 1 gates |
| Cost control (thinking off, minimal schemas, ~pennies/trace) | Done | Headroom exists for escalation |
| **The app referees itself in production** | **Missing** | **Phase 1 — the biggest single win** |
| **Placement by AI coordinates** | **Fragile by design** | **Phase 2 — remove it** |
| **User can see what the read got wrong** | **Missing** | **Folded into Review — no new surface (Daniel: no compare view, no bloat)** |
| Corpus breadth (4 sets, all one architect + FL0) | Narrow | Phase 4 — add diverse public plans |
| Stochastic stability (each set passes repeatedly) | Unproven | Phase 4 — 3 consecutive clean sweeps |
| Server resilience (crash guard, atomic saves, auto-restart) | Done | — |
| Two-tab shared-project hazard | Known, documented | Accept for MVP; note for testers |
| Blender-free IFC (port ifc_writer.py to JS) | Queued | Post-MVP |
| Custom-footprint frame/IFC/permit gaps | Documented honestly | Post-MVP |
| Sharing (GitHub + Codespace + TESTING.md) | Done | Ship at Phase 4 exit |

## The three moves

### Phase 1 — The app referees itself — **DONE 2026-07-12**
Shipped: server-side scoreTrace after every trace; below 10/11 the takeoff
re-runs once on the pro model tier (GEMINI_PRO_MODEL, rolling alias);
plain-language score opens the chat reply; doubts stamp `spec.traceReview`
and surface as Review flags (spec-derived ones re-check live and auto-clear
when fixed; plan-only ones persist until the next trace); every real trace
auto-captures to `.data/trace-corpus/captured/` (hash-deduped, out of the
sweep folder — curation = move a PDF up one level). Verified: 287 unit
checks + a live corpus set end-to-end (10/11, score in summary, capture
written). Original spec follows for reference:
Move the corpus scorer INTO the trace pipeline. After every in-app trace:
- Score the result against the invariants **server-side**.
- Below the gate (10/11): **auto-retry** the weak passes once, escalating the
  rooms/openings passes to the stronger Gemini model tier (cost: still cents).
- Report in chat, plain language: "Read your drawing — 11 of 11 checks
  passed" or "10 of 11 — two rooms may sit wrong; tap Review to see them."
- **Auto-capture every real trace** (PDF + result + score) into
  `.data/trace-corpus/` so Daniel's actual usage builds the regression corpus
  by itself. No more "send me the file."

**Exit test:** Daniel attaches any drawing; the app itself tells him how good
the read was; a bad read retries without him asking. No assistant involved.

### Phase 2 — Take placement away from the AI (1–2 sessions)
LLMs are good at reading *what exists* (room names, dimensions, which room
touches which) and bad at emitting *coordinates*. Split the job:
- Rooms pass returns a **room list + adjacency graph** (Kitchen 14×12,
  touches Living on its east, on the north wall…), no x/y.
- A **deterministic tiler** (extend the existing packRooms/arrangeRoomsPlan)
  places the list inside the shell honoring adjacency + wall hints. Same
  input → same output, forever.
- AI coordinates become a *hint*, never the authority. The whole class of
  "room floating in the yard / rooms piled up" becomes impossible, not rare.

**Exit test:** 20 consecutive traces of one drawing produce the same room
layout (names may vary on unlabeled plans; geometry may not).

### ~~Phase 3 — Trust UI~~ CUT (Daniel, 2026-07-12: "don't want to bloat the thing")
No compare view, no new surface. What it was for is covered without new UI:
- Phase 1 already reports the read-score in chat in plain language.
- Trace doubts (inferred names, estimated positions) become ordinary
  **Review flags** — the panel that already exists, already jumps to the
  object when tapped. Build this as part of Phase 1's reporting, not later.

### Phase 3 — Prove it, then ship it
- Add 4–6 diverse floor plans to the corpus (public/permit-set samples:
  labeled, unlabeled, hand-drawn, multi-storey).
- **Stability gate: three consecutive full-corpus sweeps, all sets ≥10/11.**
  (Scriptable overnight; costs under a dollar.)
- Then: TESTING.md check, zip/link to the 2–3 testers, friend pulls.
- MVP is declared when testers' first hour produces no "wait, why can't I—".

## What this app will never promise (say it, don't hide it)

- **Pixel-perfect reproduction of a drawing.** No consumer tool does this;
  architects redraw each other's plans too. The promise is *good bones,
  honestly scored, fast to refine*.
- Roof valleys, custom-outline frames in 3D, custom-outline IFC/permit
  sheets — documented gaps, post-MVP.

## Rules of engagement (for every future session)

1. Execute the current phase. Do not invent side quests.
2. Every failure becomes a corpus set + an invariant + a class fix — never a
   one-off patch, never a hand-edit of Daniel's design (data repairs only on
   his explicit ask, and say so).
3. A fix is done when the FULL corpus passes, not the one set that failed.
4. If a phase exposes something structural, update THIS file first, then act.

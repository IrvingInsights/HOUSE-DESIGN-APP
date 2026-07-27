# CLAUDE.md

**Read [`AGENTS.md`](./AGENTS.md) first — it is the operating contract for this
repo and it binds you.** Everything below is a summary; `AGENTS.md` is the
authority.

The three laws, in short:

1. **One place.** This repo is the only home for this project. Never make a
   second copy, never leave a deliverable outside it, and move in anything
   related you find elsewhere (→ `design-archive/`).
2. **GitHub is always current.** Every session ends: tests → `git add -A` →
   `git commit -m "update NNN: <plain sentence>"` → `git push origin HEAD`.
   Never stop with a branch ahead of origin.
3. **Notion is always current.** Every session ends by updating the *House
   Design App* section of 🏡 **07 — House**
   (<https://app.notion.com/p/3a041623f9ca81ebb481c3d55970713c>): current state,
   one session-log row, and any decision made.

Then read, in order: `HANDOFF.md` → `STRATEGY.md` → `RESUME.md` → `TESTING.md` →
the newest `SESSION-HANDOFF-*.md`.

Daniel is a non-coder. Plain language, always. Fix the class, never the
instance. Never hand-edit his design data. Backend `.mjs` edits need a server
restart.

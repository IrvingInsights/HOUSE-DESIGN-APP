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
3. **Photion is always current.** Every session starts with `orient` and
   `project_snapshot` on the **House Design App** project, and ends with one
   `record_snapshot` there: current state, decisions, do-not-change, next
   step. Photion replaced Notion on 2026-09-03.

4. **Latest binding design wins; nothing is deleted.** All House efforts (app,
   drawings, search, build) are ONE project. The most recent explicit decision
   supersedes earlier ones — but "latest" means the latest *decision*, not the
   most recently-touched *file*; earlier material stays a live source until
   explicitly replaced, and nothing is ever deleted. Full rule + order of
   authority + where things live: [`UNIFICATION.md`](./UNIFICATION.md).

Then read, in order: `UNIFICATION.md` → `HANDOFF.md` → `STRATEGY.md` →
`RESUME.md` → `TESTING.md` → the newest `SESSION-HANDOFF-*.md`.

Daniel is a non-coder. Plain language, always. Fix the class, never the
instance. Never hand-edit his design data. Backend `.mjs` edits need a server
restart.

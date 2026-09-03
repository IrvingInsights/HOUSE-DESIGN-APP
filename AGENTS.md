# AGENTS.md — read this before you touch anything

**This file is the operating contract for every AI agent, assistant, or tool
that opens this project — Claude, Codex, Gemini, Copilot, Cursor, Antigravity,
Continue, or anything else. If you are an AI and you are reading this repo, these
rules bind you.**

Owner: Daniel Irving. He is a non-coder. Plain language, always.
Canonical repo: <https://github.com/IrvingInsights/HOUSE-DESIGN-APP>
Canonical Notion hub: **🏡 07 — House** →
<https://app.notion.com/p/3a041623f9ca81ebb481c3d55970713c>

---

## THE THREE LAWS

### 1. ONE PLACE. This repo is the only place.

There is exactly one home for this project: this repository, cloned at
`C:\Users\danir\HOUSE-DESIGN-APP` on Daniel's machine and mirrored on GitHub.

- **Never create a second copy of this project** — not in Downloads, not in a
  scratch folder, not in a new "v2" directory, not in a sandbox you forget to
  fold back in. If you need scratch space, use `.data/` (gitignored) or a git
  branch.
- **Never leave a deliverable outside this folder.** If you generate a file for
  Daniel — a drawing, an export, a spec, a zip — it lands inside this repo (see
  the map below) *and* gets committed. A file that only exists in a chat
  attachment or a downloads folder is a file that is already lost.
- **If you find related material anywhere else, move it in.** Downloads,
  Desktop, a stray project folder, an old export — pull it into
  `design-archive/`, add a line to `design-archive/README.md` saying what it is
  and where it came from, commit it, and tell Daniel what you moved.
- Never fork the project to "try something." Branch instead.

### 2. GITHUB IS ALWAYS CURRENT. Never end a session unpushed.

The single worst failure mode this project has had is work sitting on Daniel's
machine, uncommitted or unpushed, for weeks. (In July 2026 it reached 38
unpushed commits.) It will not happen again.

**Every working session ends with this sequence, without being asked:**

```bash
node tools/design_space_test.mjs      # the correctness gate — must run dry
node tools/op_smoke_test.mjs          # after any bim-core edit
git add -A
git commit -m "update NNN: <plain-language sentence about what changed>"
git push origin HEAD
```

- **Commit message style:** `update NNN: ` followed by one plain sentence in
  Daniel's voice, describing the change as a *behaviour*, not a diff. Look at
  `git log` — "a structure sheds where it needs to, and can be skinned",
  "the wall-height label says where its handle actually is". Match that. Bump
  NNN by one each time, and keep `UPDATE_STAMP` in the app in step with it.
- **Push before you stop.** Not "when convenient." Before you stop. If you
  cannot push (no network, no credentials), say so loudly in your last message
  and tell Daniel the exact command to run.
- **Never leave a branch ahead of origin at the end of a session.** If you
  finish work on a `claude/*` branch, push it and open a PR to `main`.
- Never rewrite pushed history. Never force-push a shared branch.
- `main` is the trunk. Feature work happens on a branch and merges via PR.

### 3. NOTION IS THE SOURCE OF TRUTH FOR STATE. Update it every session.

Daniel runs a 6-domain Notion system and Notion is his single source of truth
across every AI tool he uses. Code lives in git; **the story of the project
lives in Notion.** Both must be current, or the next agent starts blind.

**Every working session also ends by updating the Notion hub page**
(🏡 07 — House → the *House Design App* section):

1. Update **Current state** — the update number, the branch, whether tests are
   green, and what is next.
2. Append one row to the **Session log** — date, update number, one sentence on
   what changed, and the commit SHA.
3. If a decision was made (a rename, a chapter split, a rule Daniel laid down),
   write it down there too. Decisions that live only in a chat transcript are
   decisions that get re-litigated.

Use the Notion MCP connector if you have it. If you have no Notion access, write
the exact block Daniel should paste, and say plainly that you could not write it
yourself. **Never silently skip the Notion update.**

---

## Where things go

| Path | What belongs there |
|---|---|
| `src/` | React/Vite frontend — ONE app: `reimagine/App.jsx` + `studio/` (the chat). `engine.js` is the client mirror of the model. The old `main.jsx`/`classic.html` build was retired in update 242. |
| `backend/` | Node backend. `bim-core.mjs` is the model authority; `planner.mjs` is the drawing-trace pipeline. |
| `tools/` | The verification batteries. These are the contract — see HANDOFF.md. |
| `design-archive/` | Prior explorations, exported drawings, model packages, superseded prototypes. Reference material, **not** live code. Every item gets a line in `design-archive/README.md`. |
| `.data/` | Local runtime state, trace corpus, logs. Gitignored — never a home for anything you want to keep. |
| `dist/`, `node_modules/` | Build output and deps. Gitignored. |

Session handoffs (`SESSION-HANDOFF-YYYY-MM-DD.md`) live at the root and are
committed. Write one whenever a session changes something structural.

## Read these, in order, before you change code

1. **`HANDOFF.md`** — what the app is, and the hard-won rules. Every rule in it
   cost a real bug.
2. **`STRATEGY.md`** — the agreed four-phase plan. Execute it in order; don't
   freelance.
3. **`RESUME.md`** — current state and the map of the code.
4. **`TESTING.md`** — how testers run it and the honest known-limitations list.
5. The most recent `SESSION-HANDOFF-*.md` — what the last agent did.

## The rules that outrank your judgment

These are Daniel's standing rules, restated here so no agent can claim it did
not see them. `HANDOFF.md` has the full list and the reasoning.

- **Fix the class, never the instance.** A feature must work for *any* design or
  drawing, not the one in front of you.
- **Never hand-edit Daniel's design data** to make a symptom disappear. The app
  must be able to do it. Data repairs only on his explicit ask, announced plainly.
- **He uses the app while you work.** `GET /api/projects/current` at diagnosis
  time — never assume which design is live. Back up state before tests.
- **Backend `.mjs` edits need a server restart.** The frontend hot-reloads; the
  backend does not. This has burned every agent that has worked here.
- **Every new op = three registrations:** bim-core handler + client mirror in
  `engine.js` + planner schema enum.
- **Nothing ships unless `tools/design_space_test.mjs` and the browser fuzz
  battery run dry.**
- **Plain language in the UI and in messages to Daniel.** Zero jargon.
- **Do not re-add a greeting card.** He killed it once on sight.

## When you are unsure

Ask him. Do not guess at scope, do not silently expand it, and do not run a
sub-task indefinitely without checking back on the bigger priority. Name the
tradeoff and let him choose.

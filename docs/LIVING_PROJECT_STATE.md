# WORKFLOW - LIVING PROJECT STATE
**Version:** 0.6
**Last Updated:** 2026-09-28
**Auto-Update:** Every session close

---

## Session Start Protocol

**Read this file first.** Then, only if you need deeper context:
- `docs/PROJECT_SPEC.md` §3 (MVP scope) — the mockup covers it, plus more (Network/CPM, POB, transfers, shifts, WBS grouping weren't in the original spec draft — see "Scope Grown Beyond Spec" below).
- `docs/LESSONS_LEARNED.md` — skim headers; LL-007–LL-009 (frozen-array/CSS-clipping debugging saga) and LL-011 (a `return` skipping a safety check) before touching drag/CSS-positioning code, anything mutating `db`-loaded data, or restructuring a function with an early exit; LL-010 (apostrophe-breaks-JS-string) before hand-editing any template-literal copy in `app.js`.

**The interactive mockup is live and is the current source of truth for UX decisions**, not this doc's prose:
**https://claude.ai/artifact/VG8GFdUXphmBCDqUa9sSgv** (currently version 38, matches the in-app build tag).

**A source snapshot also lives in this repo at `mockup/`** (added this session for external review without touching claude.ai's own sharing) — it's the same 5 files as the live artifact and is now the working copy edits are made to before publishing; re-sync by copying the artifact's files back in if the two ever drift.

**Immediate next actions, in order:**
1. User-test v37 — confirms the PDF-import crash fix (see "Fixed This Session" below) and the new resource-matching + theme toggle features, none of which have been exercised in a live browser by anyone but the user.
2. Share the mockup with coworkers via **email invite** (not the bare public link — see "Sharing with Coworkers" below) so they can start using it and giving feedback.
3. **Resolve the open distribution/architecture decision** (below) before starting real Supabase/Netlify work.
4. Build the reorder-by-drag feature if/when it becomes a priority (scoped, not built — see below).
5. Before going live: flip the default boot state from the Galoc demo/seed data to a genuinely empty project — explicitly deferred this session at the user's request, not forgotten. See "Known Real, Not-Yet-Built Gaps."

---

## WBS Grouping (built, v35 — needs live-browser testing)

MS Project/Primavera-style task grouping: summary tasks that expand/collapse with a rolled-up bar, multi-select add/remove, and dependency arrows that re-anchor (not vanish) across a collapsed group. Prototyped standalone first (**https://claude.ai/artifact/CBCtqMziWrn2QaSe9ABtrt**, approved), then built in three rounds as live testing found gaps — the full build-out narrative lives in git history and this session's transcript, not repeated here.

**Model:** a group is a task row (`group:true`, one level of nesting, `.parent` always null on a group itself); a leaf points at its group via `.parent`. Dates are never stored on a group, always computed live from its children (`rollupOf`). Dependencies are leaf-only. **Phase headers are also a valid grouping target** (not just user-created groups) — they get their own rollup bar and are a legitimate destination for reparenting, which makes cross-phase moves an explicit action rather than something silently skipped.

**Three ways to reparent a task** (all through one function, `applyReparent`): checkbox multi-select + action bar (+New group / Move to ▾ — lists groups *and* phases / Remove from group); a one-click **Indent (⇥)** that joins whatever sits immediately above it; **drag-and-drop** via a grip (⠿) onto another task, a group, or a phase header.

**The PDF/WBS-table importer now rebuilds groups from the source schedule's own outline** instead of discarding it — a leaf's immediate WBS parent (when it's a real row below the guessed phase) becomes an actual group, so an imported Primavera/MS Project schedule keeps its own summary/sub-task breakdown. Excel/CSV import is unchanged (no hierarchy signal in a flat spreadsheet).

**Defaults chosen** (open questions at design time, resolved during implementation): single-level nesting only; dependencies never attach directly to a summary task; collapse state is just a task-object field, so it persists via the existing `db`-backed autosave with no separate mechanism.

---

## Fixed This Session (2026-09-28)

**A real crash, found via an actual browser stack trace, not a guess** — see LL-011 for the full writeup. `loadState()` had an early `return` (in the "db capability unavailable" branch) that skipped its own end-of-function safety check for a mismatched `state.projectId`, so `project()` could return `undefined` and crash `renderAll()` on the very next render — which is why the user's PDF import appeared to parse but never reached the review table. Fixed at both ends: the safety check now runs regardless of which branch loadState takes, and `project()` itself self-heals (falls back to the first project) as a second line of defense.

**Resource-aware import.** Previously, an Excel Resource column was just text-dumped into Notes — never a real assignment — and only the first sheet of a workbook was ever read. Now: a resource column, a same-workbook resource sheet, or a wholly separate resource file (new optional upload in the import modal) are all name-matched against the roster. Obvious matches (exact, case-insensitive) go straight through; anything ambiguous surfaces in a small "resources found" panel for a one-time decision (match to existing, or create new) before the final import — deliberately not silent/fuzzy-auto-matched, per direct instruction. New resources get created in the roster at commit time.

**Light/Dark/System theme toggle** — a button next to the WorkFlow logo, cycles the three states the CSS already supported (it just had no UI control before), remembered per-device via `localStorage`.

**Clean-slate default — done (v38), superseding the "leave it for now" note from earlier this session.** The user changed direction and asked for it now: `loadState()` defaults to one empty project (`BLANK_PROJECTS` in `data.js`) instead of the Galoc demo. `SEED_PROJECTS`/`SEED_RES`/etc. still exist purely as what a new "↺ Load demo data" sidebar button restores on request (two-click confirm, since it overwrites current data) — that button itself is a candidate to remove before real launch, not yet decided.

**Also fixed, from user feedback on v37/v38 screenshots:** `.chip.ok` was referenced in the toolbar JS (POB tracking / Columns buttons) but never defined in CSS, so those two controls had no background or border in either theme — most visible in dark mode. New-project/new-task Name field placeholders no longer reference demo-specific examples. `#importPastePane` relied on a negative inline margin for spacing; replaced with a real flex gap to remove the overlap risk structurally rather than re-tune the number.

---

## Current Status

**Overall Progress:** Still 0% real app code (no Vite/React/Supabase work started). The interactive mockup, however, is now extremely deep — far beyond a static prototype. Full CRUD, its own persistence, real import (including a from-scratch PDF/WBS-table parser), and a long list of live-tested UX fixes. Treat it as a high-fidelity, clickable spec, not throwaway.

**What the mockup does today** (multi-file Artifact: `index.html`, `style.css`, `data.js`, `app.js`, `import.js`):
- **Gantt tab** — phase-grouped tasks/milestones; drag to reschedule, drag edge to resize, drag either end's knob onto another bar to link a dependency (cycle-safe, click the arrow to delete it); a Start/End/Days anchor-pin system in the task drawer (pick which field stays fixed while editing the other two); optional inline columns beside each task (Start/End/Days/%/Status/WBS/Source-duration, toggled via a "Columns" picker); a searchable predecessor typeahead sorted by temporal proximity; selected-task row/bar highlighting; a Personnel Transfers lane and a toggleable POB lane, both pinned below the date header while scrolling; Day/Week/Month zoom.
- **Resources tab** — full roster, shift patterns, per-resource utilization heatmap, POB cap.
- **Network tab** — auto-generated critical-path (CPM) diagram.
- **Guide tab** — in-app onboarding flow.
- **Projects** — full lifecycle (create/rename/status/delete), not fixed to seed data.
- **Persistence** — the artifact's own bundled `db` capability (shared JSON doc store, no external backend). See "Sharing with Coworkers" below for what this means and doesn't mean for multi-user use.
- **Import** — WorkFlow JSON backup; Excel/CSV (auto-matched columns, optional leftover-column capture, Start/End/Duration consistency flags, real resource name-matching — see below); a from-scratch deterministic parser for MS Project/Primavera-style WBS-table PDFs (upload the PDF directly, or paste extracted text) — no AI call, no size limit, handles day-first dates and WBS hierarchy correctly, and now rebuilds the source's own summary/group structure (see "WBS Grouping" below); falls back to an AI-interpret path for genuinely unstructured paste text.
- **Export/Print** — `.json` round-trip, `.csv`, native browser print with a dedicated print stylesheet.
- **WBS grouping** — summary tasks, expand/collapse, multi-select/indent/drag-drop to group, phase headers double as a grouping target too. See dedicated section below.
- **Resource matching on import** — a Resource column, a same-workbook resource sheet, or a separate resource file all get name-matched against the roster, with a review step for anything ambiguous. See "Fixed This Session" below.
- **Light/Dark/System theme toggle** — sidebar button, remembered per-device.

**Critical rule reversed this session (2026-09-22, first pass):** `CLAUDE.md`'s original "click-to-edit, not drag-to-resize" rule (carried forward from SAL Operations without ever being decided for WorkFlow) is gone. Direct manipulation is now the intended interaction model; every drag/edit writes a dated history entry, nothing silently overwritten. See LL-003.

---

## Known Real, Not-Yet-Built Gaps

Asked about or scoped, deliberately deferred:
- **Whether "Load demo data" survives to real launch** — added in v38 as a convenience for continued testing now that the app boots blank by default; may or may not want to keep it once live.
- **Drag-to-reorder tasks within a phase** — user wants press-and-hold-drag on a task's row label to manually resequence it (separate from the drag-to-group grip). Scoped (visual-only, snaps back to date order on next render/edit — confirmed with the user) but not built.
- **Predecessor-column import** (e.g., Primavera's `12FS+2d` syntax) — no real document with this column yet; deferred per LL-006.
- **Per-project custom phases** — the importer's phase-guessing maps into a fixed 6-item global `PHASES` list (`data.js`); a real schedule has far more groupings of its own. Real product question, not a mockup polish item — WBS grouping covers *some* of this need already, worth revisiting whether it's now sufficient before building custom phases too.
- **Bar color: status vs. phase-driven** — asked directly, user confirmed: keep the current status-driven fill. Settled, don't revisit without new input.
- **PDF/WBS-table resource import** — the deterministic parser still doesn't capture a resource column (no real Primavera PDF sample with one seen yet, so nothing built rather than guessing the format — same discipline as LL-006). Works today via the separate optional resource-file upload alongside a PDF/paste import instead.

---

## Sharing the Mockup with Coworkers (resolved)

User's real near-term goal: internal use, side project on GitHub, not monetized. Coworkers should be able to use it for their own work ASAP and give feedback — each works on their **own separate project**, independently (not co-editing one shared schedule; a possible future "collaborative planning — stitch scopes together" feature was mentioned but isn't needed now).

Checked the `db` capability's actual spec rather than guessing: it's shared by default (not per-viewer-private — the mockup doesn't use the special `data/users/<id>/` namespace), with "last-writer-wins, no transactions" and no live sync. Since each coworker uses a separate project document, this collision risk barely applies to the described usage — it would only matter once two people edit the *same* project at once.

**Decision: use the mockup as-is, shared via the artifact's email-invite option (not the bare public link)** — the Share menu's own description notes email invites to people outside the organization are supported separately from the plain link, which is likely what avoids a read-only cap for the user's outside-org coworkers (confirmed their coworkers are outside the org). No standalone app or rushed hosted build needed just to unblock this pilot.

**Worth remembering:** a standalone Electron app would be the *wrong* direction for the eventual "collaborative planning" feature — it gives each person their own local copy with zero built-in sharing, the opposite of what cross-person scope-stitching needs. When that feature becomes real, it points toward the hosted Netlify+Supabase path (real-time sync, per-user auth, real audit trail), not toward standalone.

---

## Open Decision: Distribution & Backend Architecture

**Not yet committed.** Changes the backend entirely, so resolve before real build work starts:

| | Hosted (original spec: Netlify + Supabase/Postgres) | Standalone (Electron + bundled local db) |
|---|---|---|
| Install | none, share a link | real installer, packaging/signing is ongoing work |
| Data | Postgres, multi-device/multi-user sync | SQLite or similar, single-device unless sync is built separately |
| Offline | no | yes |
| Fits "most projects aren't massive"? | over-provisioned for a small crew schedule | closer fit |
| Fits sharing with coworkers / future collaboration? | yes — this is what it's for | actively works against it |

Given this session's coworker-sharing decision (above) leans the actual near-term need toward "hosted," and the future collaborative-planning feature would need hosted's real-time sync regardless — **standalone is looking like the wrong direction unless something changes**, but this still hasn't been explicitly decided with the user. Ask directly before writing any real code. If standalone is somehow still chosen, update `PROJECT_SPEC.md` §4 (currently documents Supabase as deliberate) and this file's tech-stack assumptions first.

---

## Scope Grown Beyond Original Spec

Came from user feedback during mockup iteration, not `PROJECT_SPEC.md`'s original MVP list — worth folding into the spec once the mockup phase closes, since these are now expected behavior, not extras: the Network/critical-path view, personnel transfer logistics (heli/boat), POB capacity tracking, shift patterns, the import/export/print tooling, and WBS grouping (summary tasks).

---

## Completed Work

- **2026-09-20:** Project spun off from SAL Operations' Rotation Forecast module. Spec written, repo scaffolded, GitHub repo created and pushed.
- **2026-09-21:** Design discussion session — confirmed mockup-first approach. No code written.
- **2026-09-22 (first session):** Long mockup-build day — initial Gantt/Resources mockup → full CRUD, drag-based direct manipulation, Network/CPM tab, POB tracking, personnel transfers, shift patterns, Guide tab → bundled-db persistence → import/export/print → full project lifecycle. See LL-001–LL-005.
- **2026-09-22 (second session):** PDF/WBS-table importer built from scratch against a real document; ten rounds of live-tested Gantt/drawer UX fixes; coworker-sharing and architecture-direction questions substantively resolved. See LL-006–LL-009. Mockup at v29.
- **2026-09-26:** WBS grouping designed as a standalone prototype first, approved, then built into the real Gantt across three rounds as live testing on the user's own schedule surfaced gaps (phase-as-group-target, then the WBS-aware importer). See "WBS Grouping" above and LL-010. Mockup at v35.
- **2026-09-28:** Source snapshot checked into this repo (`mockup/`) for external review. Real PDF-import crash found via a live stack trace and fixed (LL-011). Resource-aware import (name-matching + review step, multi-source) and a Light/Dark/System theme toggle built. Mockup at v37.
- **2026-09-29:** Blank-by-default boot state (demo now opt-in via a sidebar button); dark-mode chip contrast bug fixed; demo-example placeholders genericized; import-modal spacing hardened. Mockup now at v38.

---

## Next Steps

1. User-tests v38 against their real schedule — confirm the PDF import completes end-to-end now (the console log from the previous attempt showed only browser-extension/platform noise, no actual app error, which is a good sign but not yet a confirmed fix), check the toolbar chips and import modal in dark mode, and try "Load demo data".
2. Share via email invite with coworkers; watch for any real friction from the "separate projects, no live sync" model as more people actually use it.
3. Get an explicit answer on hosted-vs-standalone (evidence leans hosted); update `PROJECT_SPEC.md` §4 once decided.
4. Once architecture is settled and mockup scope feels sufficient: fold "grown beyond spec" items (including WBS grouping) into `PROJECT_SPEC.md`, then start the real build.

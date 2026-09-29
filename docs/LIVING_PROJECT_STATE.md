# WORKFLOW - LIVING PROJECT STATE
**Version:** 0.8
**Last Updated:** 2026-09-29
**Auto-Update:** Every session close

---

## Session Start Protocol

**Read this file first.** Then, only if you need deeper context:
- `docs/PROJECT_SPEC.md` §3 (MVP scope) — the mockup covers it, plus more (Network/CPM, POB, transfers, shifts, WBS grouping weren't in the original spec draft — see "Scope Grown Beyond Spec" below).
- `docs/LESSONS_LEARNED.md` — skim headers; LL-007–LL-009 (frozen-array/CSS-clipping debugging saga) and LL-011 (a `return` skipping a safety check) before touching drag/CSS-positioning code, anything mutating `db`-loaded data, or restructuring a function with an early exit; LL-010 (apostrophe-breaks-JS-string) and LL-012 (a CSS class referenced only in JS, never defined) before hand-editing `app.js`/`style.css` together.

**The interactive mockup is live and is the current source of truth for UX decisions**, not this doc's prose:
**https://claude.ai/artifact/VG8GFdUXphmBCDqUa9sSgv** (currently version 41, matches the in-app build tag). **A source snapshot also lives in this repo at `mockup/`** (for external review without touching claude.ai's own sharing) — same 5 files as the live artifact, and now the working copy edits are made to before publishing.

**Known unresolved: the "sample" (AI-interpret) capability is stuck declined** for the user's own account/browser on this artifact — `sample.json(...)` throws `not_granted` every time, no permission prompt on retry (confirmed: reloaded, retried, still declined). Platform/browser permission state, not a code bug — nothing in `app.js`/`import.js` fixes it directly. Affects the AI-interpret fallback for unstructured pasted text and for a resource-file PDF that doesn't match the deterministic manning-list pattern. Everything else (deterministic WBS-table parsing, Excel/CSV, the deterministic resource-file pattern) works without it. Remove this note once resolved.

**Immediate next actions, in order:**
1. **Live-browser-test v40** — the whole "v40 — Large UX Feedback Batch" section above was built without a browser this session (no browser tool available); it's the top priority to verify before trusting any of it, same as v35's WBS grouping needed.
2. User-test v39/v40 against the real schedule PDF and the manning-list PDF — confirm the crash fix holds end-to-end and the new deterministic resource-file parsing actually picks up real names/counts.
3. The user's actual schedule PDF turned out to be a **Gantt/timeline-view export** (task names + repeating date columns), not the WBS/Duration/Start/Finish table format the deterministic parser handles — it correctly falls through to AI-interpret today, which is blocked by the stuck permission above. Waiting on the full extracted text (not just a preview) before building a dedicated parser for this format — see LL-006's own discipline on this.
4. Build the Dashboard/Analytics mockup (see v40 section above for proposed content) — or confirm the content list with the user first if they want to steer it.
5. Share the mockup with coworkers via **email invite** (not the bare public link — see "Sharing with Coworkers" below).
6. **Resolve the open distribution/architecture decision** (below) before starting real Supabase/Netlify work.
7. Decide whether "↺ Load demo data" (sidebar) survives to real launch, or comes out once the app is live.

---

## v44 — found the real "links displaced" bug (LL-014)

A screenshot finally made it undeniable and traceable: `.overlay` (wraps the dependency-arrow SVG + today-line) had `left:280px` hardcoded in CSS, left over from when the Task/Phase label column was a fixed width. Once that column became resizable this session (`state.nameColWidth` → `--label-w`), `.overlay` was the one place still assuming the old fixed 280 — every arrow was drawn off by `(actual label width − 280)` px. Fixed to `left:var(--label-w, 280px)`, same variable already used everywhere else. Resources tab is unaffected (no `--label-w` set in that scope, so it correctly falls back to the 280 default). See LL-014.

## v43 (same session, fourth round — corrected a wrong fix)

The v42 "bar follows phase color" fix used a left-edge border stripe — wrong, per direct correction: replaced with a translucent wash (`--phase-c` at ~22-28% opacity via `mix-blend-mode`) layered over the status fill, so the bar visibly follows its phase/group header color but less opaque than the header itself, without a border and without covering the status indication. **Lesson for next time: "the bar should follow the header" meant the bar's own color/fill, not a decorative accent — should have asked instead of picking a border as a safe-feeling middle ground.**

## v42 + Dashboard v2 (same session, third feedback round)

Main app (v42): link knobs moved to the bottom corners of the bar (from top, per feedback); collapse/expand now uses an explicit +/− glyph instead of a rotating chevron (direction wasn't a clear state signal); **grouping/reordering redesigned** — dragging a task onto another task/milestone is now *always* a reorder (top half=before, bottom half=after), never grouping, removing the fragile pixel-zone split that made "does it group or reorder" unpredictable; grouping two loose tasks now goes through the ⇥ indent button or multi-select+"New group" instead of drag. Phase/group color now actually shows on the Gantt bars themselves (a persistent colored left-edge accent on every task bar, plus group rollup bars now colored like phase rollup bars already were) — previously phase color only reached the swatch, not the bars.

Dashboard prototype v2 (same URL, https://claude.ai/artifact/LmYXYxC1zd3TxQ9boxRVc1): fixed a real conceptual bug — the "Critical path" KPI was counting the manually-set "Flagged critical" status, not an actual computed CPM critical path (zero float, same definition the Network tab uses); relabeled and clarified with a tooltip. Added a phase-timeline section (horizontal bars across the real date range so overlapping phases are visible — prep/P&A/plant-deactivation genuinely overlap in week 1–2 of the demo schedule). Phase-progress hold/critical flags now have hover tooltips naming the actual task and reason. POB trend got a heli/boat transfer marker overlay with a working show/hide toggle and legend. Resource utilization changed from a single static peak-vs-cap bar (no context) to an 8-window heat-strip per resource across the same date range, so *when* a resource is busy is visible, not just its peak.

## v41 follow-ups (same session, after user reviewed v40's description)

User caught real gaps/regressions in the v40 write-up before ever opening a browser — worth noting since it means some of v40's design choices were wrong on inspection, not just untested:
- **Pin toggles were the wrong design** — rebuilt as a single show/hide toggle (toolbar chip, one per row) where "shown" always means frozen at top; the separate "shown but not frozen" state from v40 wasn't wanted at all.
- **Phase color swatch was too subtle to notice** — was a 4px bar with only a hover outline as a hint; now a real 14px clickable dot, plus a reset-to-default button. Colors are phase-level only, not per-group — groups/tasks inherit their phase's color, matching how phase-swatches already worked everywhere else in the app.
- **Dependency arrows disappearing on phase-collapse** — real bug, not related to reordering: `anchorTask()` only re-anchored a dependency arrow when a *group* was collapsed, never when the whole *phase* was collapsed, so arrows into/out of a collapsed phase's tasks just vanished (layout had no entry for them). Fixed — see LL-013's neighbor lesson if one gets written up. **Still unconfirmed:** user also reported links looking "displaced" specifically right after creating a new one via drag-to-join — no code-level cause found for that one after tracing the ghost-line/SVG-render/anchor logic; flagged for a concrete repro (exact steps or a screenshot) rather than guess-patched further, per this project's own LL-007 discipline.
- **Per-column resize was wrongly called infeasible** — re-examined and built after all: the inline columns (Start/End/Days/etc.) turned out to have fully uniform, fixed widths and order across every row (row-label's `.name` span is the only elastic element, flex:1, absorbing all variation), so a real per-column header with resize handles was safe to add. Lesson: "there's no header row to anchor to" was true but not itself a reason it can't be built — should have checked layout math before declaring it a gap.
- **Indent/remove-from-group/row-grip buttons were invisible** — `opacity:0` until row hover, easy to never discover at all (reported: "I don't see this button"). Changed to a faint always-visible state, full opacity on hover.

## v40 — Large UX Feedback Batch (built, NOT browser-tested this session)

User gave a batch of ~14 UX asks after a live-testing pass on v39. All built directly into the mockup this session except Dashboard/Analytics (deferred — see below). **None of this has been opened in a real browser yet** (no browser tool available this session) — syntax-checked with `node --check` only. Treat as needing the same live-testing pass v35's WBS grouping got before trusting it.

- **Undo/redo** — full deep-clone snapshot stack (not per-field diffing), captured automatically inside `persistProject`/`persistConfig`/`persistProjectIndex` (every mutation already funnels through one of those three). Synchronous bursts of persist calls (e.g. "Load demo data") coalesce into one undo step via a 120ms window. Ctrl+Z / Ctrl+Y, plus ↶/↷ buttons in the toolbar.
- **Clear all data** — new sidebar button next to "Load demo data", same 3-second arm-to-confirm pattern already used for demo-load and task-delete.
- **Drag-to-reorder within a phase/group** — extended the existing row-grip drag (previously group/reparent-only) rather than building a separate mechanism: dropping on the **top ~30%** of another task/milestone row reorders next to it (new `sortIndex` field, persisted, falls back to date-sort when unset); dropping lower down still groups/reparents as before. Phase headers and groups always group regardless of drop position (reordering isn't meaningful there).
- **Resize handle vs. link knob** — root cause was the knob's invisible hit-area extending ±10px vertically while centered mid-bar, at higher z-index than the resize handle, so it silently ate almost the entire edge column. Moved the knob to the bar's top corner and shrunk the hit-area to ±3px — resize handle now has the lower ~2/3 of the edge free.
- **Personnel Transfers / POB rows** — each now has its own 📌 pin toggle (label area) instead of being unconditionally sticky; unpinning falls back to scrolling normally. POB's sticky offset self-adjusts when Transfers is unpinned above it.
- **Theme toggle** — was a bare 26px icon button with muted colors, hard to notice per the user. Now has a visible text label (System/Light/Dark) plus accent-colored border/background.
- **Milestone toggle in the task drawer** — previously milestone-vs-task was fixed at creation. The edit drawer now has the same "This is a milestone" checkbox as the New Task modal, and `saveDrawer` handles converting either direction.
- **Task/Phase column resize** — drag handle on the axis-corner's right edge, resizing `state.nameColWidth` (default 280, clamped 160–560). Scoped to the Gantt tab only (Resources tab stays fixed at 280px, unchanged). **Per-column resize for the optional inline columns (Start/End/Days/%/Status/WBS/Source-duration) was NOT built** — there's no header row for them to anchor a resize handle to (they render inline per-row with no column headers at all), and building one safely without a browser to verify layout felt too risky this session. Real gap if the user wants it.
- **Phase color labeling** — phase colors (`PHASES[i].color`, previously `var(--pN)` theme-adaptive constants) are now editable: click a phase row's swatch to open a native color picker. A custom pick is a flat hex, so it opts out of light/dark adaptiveness once set (documented tradeoff, not a bug). Persisted as a `{phaseId: color}` map in `config/main`, reapplied over the defaults on load via `applyPhaseColors()`.
- **Demo data anonymized** — the seed dataset was a real, previously-identifying project (Galoc FPSO, a real Philippines field) plus real vendor/personnel names (Halliburton, ICON, a named person in a history entry). Renamed to fictional "Kestrel FPSO Decommissioning" (+ "Osprey"/"Harrier" for the other two demo projects), vendor names genericized to role-only ("Contractor", "Construction Crew" etc.), personal name in a history entry replaced with "Ops".
- **"Click to add/remove group member"** — remove already existed (✕ button on a grouped task); add already exists via checkbox multi-select + "Move to" action bar, or the ⇥ indent button. No new code — flagged to the user as already covered, not literally "click the task to add it" which isn't built.
- **Dashboard/Analytics — standalone prototype built and approved-to-build-from**: **https://claude.ai/artifact/LmYXYxC1zd3TxQ9boxRVc1** ("Schedule Dashboard"), same pattern as the WBS-grouping prototype (`CBCtqMziWrn2QaSe9ABtrt`) — a separate mockup, not wired into the main app artifact yet. Reuses the real app's own color tokens/fonts (Big Shoulders Display + IBM Plex Sans/Mono, same --p1..--p6 phase hues) so it reads as a real screen of the same product, and uses illustrative numbers derived from the actual Kestrel demo dataset (34% overall complete, phase-by-phase rollup, a POB trend chart, resource utilization bars, upcoming milestones, flagged/at-risk tasks) rather than placeholder content. **Not yet integrated as a real tab in the main mockup** — next step is either folding it in as a 5th tab (Gantt/Resources/Network/Guide/Dashboard) once the layout is approved, or iterating on the concept further first.

---

## WBS Grouping (built, v35 — needs live-browser testing)

MS Project/Primavera-style task grouping: summary tasks that expand/collapse with a rolled-up bar, multi-select add/remove, and dependency arrows that re-anchor (not vanish) across a collapsed group. Prototyped standalone first (**https://claude.ai/artifact/CBCtqMziWrn2QaSe9ABtrt**, approved), then built in three rounds as live testing found gaps — the full build-out narrative lives in git history and this session's transcript, not repeated here.

**Model:** a group is a task row (`group:true`, one level of nesting, `.parent` always null on a group itself); a leaf points at its group via `.parent`. Dates are never stored on a group, always computed live from its children (`rollupOf`). Dependencies are leaf-only. **Phase headers are also a valid grouping target** (not just user-created groups) — they get their own rollup bar and are a legitimate destination for reparenting, which makes cross-phase moves an explicit action rather than something silently skipped.

**Three ways to reparent a task** (all through one function, `applyReparent`): checkbox multi-select + action bar (+New group / Move to ▾ — lists groups *and* phases / Remove from group); a one-click **Indent (⇥)** that joins whatever sits immediately above it; **drag-and-drop** via a grip (⠿) onto another task, a group, or a phase header.

**The PDF/WBS-table importer now rebuilds groups from the source schedule's own outline** instead of discarding it — a leaf's immediate WBS parent (when it's a real row below the guessed phase) becomes an actual group, so an imported Primavera/MS Project schedule keeps its own summary/sub-task breakdown. Excel/CSV import is unchanged (no hierarchy signal in a flat spreadsheet).

**Defaults chosen** (open questions at design time, resolved during implementation): single-level nesting only; dependencies never attach directly to a summary task; collapse state is just a task-object field, so it persists via the existing `db`-backed autosave with no separate mechanism.

---

## Recently Fixed (2026-09-28 → 09-29, v35 → v39)

- **Real PDF-import crash** (LL-011): `loadState()`'s early `return` on the "db unavailable" branch skipped its own safety-net check for a mismatched `state.projectId` → `project()` could return `undefined` → crashed `renderAll()`. Fixed at both ends (the check now always runs; `project()` self-heals too).
- **Resource-aware import**: a Resource column, a same-workbook resource sheet, or a separate resource file (Excel/CSV **or PDF**, as of v39) all get name-matched against the roster — clear matches go straight through, ambiguous ones get a one-time review step, roster-only entries (not linked to any task) are an opt-in checklist. A resource-file PDF tries a deterministic "Name … count" pattern first, only falls back to AI if that finds nothing (relevant given the stuck-permission issue above).
- **Light/Dark/System theme toggle**, remembered via `localStorage`.
- **Clean-slate default boot** (v38) — one empty project by default, demo restorable via "↺ Load demo data."
- **Dark-mode chip contrast** (LL-012): `.chip.ok` was referenced in JS, never defined in CSS.
- Demo-specific placeholder text genericized; `#importPastePane` layout hardened (real flex gap, no more negative-margin hack).

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
- **Resource matching on import** — a Resource column, a same-workbook resource sheet, or a separate resource file (Excel/CSV or PDF) all get name-matched against the roster, with a review step for anything ambiguous. See "Recently Fixed" below.
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
- **2026-09-29 (second session):** Large batch of UX feedback from live testing of v39, built directly into the mockup — undo/redo, clear-data (with confirm), drag-to-reorder within a phase, resize-handle/link-knob conflict fix, individual pin toggles for Transfers/POB, more visible theme toggle, milestone toggle in the edit drawer, Task/Phase column resize, clickable phase colors, and demo-data anonymization (real field/vendor/personal names replaced with fictional ones). Dashboard/Analytics deliberately deferred to its own mockup first. Mockup at v40 — **not yet live-browser-tested**, see "v40 — Large UX Feedback Batch" above.
- **2026-09-29 (first session):** Blank-by-default boot state (demo now opt-in via a sidebar button); dark-mode chip contrast bug fixed (LL-012); demo-example placeholders genericized; import-modal spacing hardened (v38). Diagnosed the PDF-import complaint down to two separate, real causes: the user's schedule PDF is a Gantt/timeline-view export the deterministic parser correctly doesn't match (needs AI-interpret, or a dedicated parser once a full text sample is available), and the AI/"sample" capability is stuck declined in the user's browser. Added PDF support (deterministic pattern + AI fallback) to the resource-file import either way, plus roster-only opt-in additions (v39).

---

## Next Steps

1. **Live-browser-test v40's whole UX batch** — nothing in it has been opened in a real browser yet.
2. User-tests v39/v40 — confirm the manning-list PDF now parses via the resource file input, and report back on the stuck AI-permission issue (browser site-settings / incognito / different browser worth trying).
3. If/when the full extracted text of the Gantt-view schedule PDF is available, build a dedicated deterministic parser for it rather than depending on the stuck AI path.
4. Review the Dashboard/Analytics prototype and decide whether to fold it into the main mockup as a 5th tab, or iterate on the concept first.
5. Share via email invite with coworkers; watch for any real friction from the "separate projects, no live sync" model as more people actually use it.
6. Get an explicit answer on hosted-vs-standalone (evidence leans hosted); update `PROJECT_SPEC.md` §4 once decided.
7. Once architecture is settled and mockup scope feels sufficient: fold "grown beyond spec" items (including WBS grouping) into `PROJECT_SPEC.md`, then start the real build.

# WORKFLOW - LIVING PROJECT STATE
**Version:** 0.9
**Last Updated:** 2026-09-29
**Auto-Update:** Every session close

---

## Session Start Protocol

**Read this file first.** Then, only if you need deeper context:
- `docs/PROJECT_SPEC.md` §3 (MVP scope) — the mockup covers it, plus more (see "Scope Grown Beyond Spec" below).
- `docs/LESSONS_LEARNED.md` — skim headers, don't read in full. LL-013/LL-014/LL-015 (this session's CSS-positioning bugs: hit-area/z-index conflicts, a stale hardcoded pixel value, `position:sticky` failing again after already being "fixed" once) before touching drag hit-areas, anything computing pixel offsets from `--label-w`, or anything relying on `position:sticky`. LL-007–LL-009 and LL-011 before touching drag/CSS-positioning code generally or restructuring a function with an early exit. LL-010/LL-012 before hand-editing `app.js`/`style.css` together.

**The interactive mockup is the current source of truth for UX decisions**, not this doc's prose:
**https://claude.ai/artifact/VG8GFdUXphmBCDqUa9sSgv** — currently **v46**, matches the in-app build tag (sidebar, bottom-left). **A source snapshot lives in this repo at `mockup/`** (same 5 files as the live artifact) — edits are made there first, then published to the artifact.

**Not fully browser-tested end-to-end.** No browser tool was available this session — every change was verified by reading code (`node --check` for syntax) and by fixing the specific bugs the user found via screenshots. Several real bugs were only caught this way (LL-013/14/15) and needed more than one round each to actually fix. Treat anything below as "should work, unconfirmed" until the user has actually clicked through it.

**Known unresolved (platform-level, not a code bug):** the "sample" (AI-interpret) capability is stuck `not_granted` in the user's browser for this artifact — affects the AI-interpret fallback for unstructured pasted text and non-deterministic PDF imports. Deterministic WBS-table parsing, Excel/CSV, and the deterministic resource-file pattern all work without it. Worth asking the user to retry (different browser/incognito) before assuming it's still stuck.

**Immediate next actions, in order:**
1. **User verifies v46 in an actual browser** — specifically: the Transfers/POB freeze (scroll down with both shown, they should now stay pinned — rebuilt without `position:sticky`, see LL-015), the reorder-vs-group drag split, and the Dashboard tab's numbers against a real schedule.
2. If the user's real schedule PDF's full extracted text becomes available: it's a **Gantt/timeline-view export** (not the WBS/Duration/Start/Finish table format the deterministic parser handles) — build a dedicated parser for it. Deferred until then per LL-006's discipline (don't guess a format from a preview).
3. **Resolve the open distribution/architecture decision** (below) before starting any real Supabase/Netlify/Electron work — a rough Electron size/cost estimate was given this session (see that section) but nothing decided yet.
4. Share the mockup with coworkers via **email invite** (resolved as the right approach, not yet actually done — see "Sharing with Coworkers" below).
5. Decide whether "↺ Load demo data" (sidebar) survives to real launch, or comes out once the app is live.
6. Fold "Scope Grown Beyond Spec" (below) into `PROJECT_SPEC.md` once the mockup phase feels done.

---

## What The Mockup Does Today

Multi-file Artifact (`index.html`, `style.css`, `data.js`, `app.js`, `import.js`), **0% of the real app built** (no Vite/React/Supabase/Electron work started) — this is a high-fidelity, clickable spec, not throwaway.

- **Gantt tab** — phase-grouped tasks/milestones/WBS groups; drag to reschedule, drag edge to resize, drag either end's knob (bottom corners of the bar) to link a dependency; a Start/End/Days anchor-pin system in the task drawer; optional inline columns (Start/End/Days/%/Status/WBS/Source-duration), both the Task/Phase column AND each inline column independently resizable via drag handles in the header; undo/redo (Ctrl+Z/Y or toolbar buttons); a searchable predecessor typeahead; a Personnel Transfers lane and a toggleable POB lane, each independently shown/hidden via a toolbar chip and **genuinely frozen above the scroll area** when shown (not CSS-sticky — see LL-015); Day/Week/Month zoom; phase colors are clickable/resettable and now show through on every task bar as a translucent wash (not just the swatch); collapse/expand uses an explicit +/− glyph.
- **Resources tab** — full roster, shift patterns, per-resource utilization heatmap, POB cap.
- **Network tab** — auto-generated critical-path (CPM) diagram — the actual computation dependency-arrows/Dashboard's "on critical path" KPI both reuse (`computeCPM`: forward/backward pass, `float = LateStart − EarlyStart`, zero float = critical; based purely on dependencies+durations, independent of a task's Status field).
- **Dashboard tab** (new this session, v45/v46) — live summary computed from the current project (no separate data model): % complete, finish date, on-critical-path count, upcoming milestones, phase timeline (shows real overlap), phase progress with real hold/critical task names on hover, POB trend with a heli/boat transfer-marker toggle, per-resource utilization heat-strip over time, flagged/at-risk list.
- **Guide tab** — in-app onboarding flow.
- **Projects** — full lifecycle (create/rename/status/delete).
- **Persistence** — the artifact's own bundled `db` capability (shared JSON doc store, no external backend, last-writer-wins, no live sync). See "Sharing with Coworkers" below for what this does/doesn't cover.
- **Import** — WorkFlow JSON backup; Excel/CSV; a from-scratch deterministic parser for MS Project/Primavera-style WBS-table PDFs (rebuilds the source's own group/summary structure); resource name-matching from a Resource column, a resource sheet, or a separate resource file (Excel/CSV/PDF); falls back to AI-interpret for unstructured text (blocked — see "Known unresolved" above).
- **Export/Print** — `.json` round-trip, `.csv`, browser print.
- **WBS grouping** — see dedicated section below.
- **Grouping/reordering (redesigned this session)** — dragging a task's grip onto another task/milestone is now *always* a reorder (top half of target = before, bottom half = after); dragging onto a group or phase header still groups/moves. Creating a new group from two loose tasks goes through the ⇥ indent button or checkbox multi-select + "New group", not drag — removes an earlier fragile pixel-zone split that made "does this group or reorder" unpredictable.
- **Theme toggle** — Light/Dark/System, visible text label + accent styling (was a near-invisible icon), remembered per-device.
- **Milestone toggle** — the edit drawer (not just task creation) can convert a task to/from a milestone.
- **Clear all data** — sidebar button, same 3-second arm-to-confirm pattern as demo-load/task-delete.
- **Demo data** — anonymized (see below); toggled in via "↺ Load demo data".

**Critical rule reversed 2026-09-22:** direct-manipulation editing (drag to resize/reschedule/link) is the intended interaction model, not click-to-edit-only. Every drag writes a dated history entry. See LL-003.

---

## WBS Grouping Model

A group is a task row (`group:true`, one level of nesting, `.parent` always null on the group itself); a leaf points at its group via `.parent`. Dates are never stored on a group, always computed live from its children (`rollupOf`). Dependencies are leaf-only. Phase headers are also a valid grouping/reparent target, same as a user-created group.

Three ways to reparent: checkbox multi-select + action bar (+New group / Move to ▾ / Remove from group); one-click **Indent (⇥)** (joins whatever sits immediately above it); **drag-and-drop** via the grip (⠿) onto a group or phase header (task-onto-task now always reorders instead — see "Grouping/reordering redesigned" above). The ✕ button on a grouped task removes it from its group.

The PDF/WBS-table importer rebuilds groups from the source schedule's own outline instead of discarding it.

Defaults: single-level nesting only; dependencies never attach to a summary task; collapse state is a plain task-object field (persists via normal autosave).

---

## Known Real, Not-Yet-Built Gaps

- **Whether "Load demo data" survives to real launch** — convenience for testing now that the app boots blank by default; TBD once live.
- **Predecessor-column import** (e.g. Primavera's `12FS+2d` syntax) — no real document with this column seen yet; deferred per LL-006.
- **Per-project custom phases** — importer's phase-guessing still maps into a fixed 6-item global `PHASES` list (`data.js`). WBS grouping covers some of this need already; worth revisiting whether it's now sufficient before building custom phases too.
- **PDF/WBS-table resource import** — the deterministic parser still doesn't capture a resource column (no real Primavera sample with one seen); works today via the separate optional resource-file upload instead.
- **Bar color: status vs. phase-driven** — previously "settled, don't revisit"; **that was revisited this session** with new input and a translucent phase-color wash was added on top of the status fill (both now show). Update: it's no longer a single either/or.

---

## Sharing the Mockup with Coworkers (resolved, not yet executed)

Near-term goal: internal use, side project, not monetized — each coworker uses their **own separate project**, independently (not co-editing one shared schedule). The `db` capability is shared-by-default with no live sync/transactions, but since each coworker uses a separate project document, that collision risk barely applies.

**Decision: share via the artifact's email-invite option**, not the bare public link (their coworkers are outside the org; email invite avoids a read-only cap the plain link may impose). Not yet actually sent.

**Worth remembering:** a standalone Electron app is the *wrong* direction for a future "collaborative planning — stitch scopes together" feature (each person gets an isolated local copy, zero built-in sharing) — that future feature points toward hosted (Netlify+Supabase) instead.

---

## Open Decision: Distribution & Backend Architecture

**Not yet committed — resolve before any real build work starts.**

| | Hosted (original spec: Netlify + Supabase/Postgres) | Standalone (Electron) |
|---|---|---|
| Install | none, share a link | real installer, packaging/signing needed |
| Data | Postgres, multi-device/multi-user sync | SQLite/JSON, single-device unless sync built separately |
| Offline | no | yes |
| Fits coworker-sharing / future collaboration | yes — this is what it's for | actively works against it |
| **Prerequisites (user has none installed today)** | none beyond a browser | Node.js/npm (~30-70MB) at minimum; Rust toolchain if Tauri instead of Electron |
| **Installer/program size** | n/a (web) | Electron: ~60-150MB installer, ~150-350MB installed (bundles full Chromium+Node regardless of app size). Tauri: ~3-10MB installer (uses OS's native webview) but needs Rust instead of Node to build |
| **Est. effort to first working build** | not scoped | rough order-of-magnitude: several dedicated sessions, real uncertainty — packaging/signing/IPC issues need the user to actually run it and report back, which drives cost more than code volume |

Coworker-sharing (resolved above) and the future collaboration feature both lean toward hosted. **Still not explicitly decided with the user.** If standalone is chosen anyway, update `PROJECT_SPEC.md` §4 (documents Supabase as deliberate) first.

---

## Scope Grown Beyond Original Spec

Came from user feedback during mockup iteration, not `PROJECT_SPEC.md`'s original MVP list — fold into the spec once the mockup phase closes: Network/critical-path view, personnel transfer logistics (heli/boat), POB capacity tracking, shift patterns, import/export/print tooling, WBS grouping, Dashboard/Analytics tab.

---

## Completed Work

- **2026-09-20:** Project spun off from SAL Operations. Spec written, repo scaffolded.
- **2026-09-21:** Design discussion — confirmed mockup-first approach.
- **2026-09-22 (×2 sessions):** Mockup built out: full CRUD, direct manipulation, Network/CPM, POB tracking, transfers, shift patterns, Guide tab, bundled-db persistence, import/export/print, project lifecycle, PDF/WBS-table importer, ten rounds of live-tested UX fixes, coworker-sharing and architecture questions substantively discussed. See LL-001–LL-009. Mockup → v29.
- **2026-09-26:** WBS grouping — standalone prototype → approved → built into the real Gantt across three rounds. See LL-010. Mockup → v35.
- **2026-09-28:** Source snapshot checked into repo (`mockup/`). Real PDF-import crash fixed (LL-011). Resource-aware import + theme toggle built. Mockup → v37.
- **2026-09-29 (session 1):** Blank-by-default boot; dark-mode chip contrast fixed (LL-012); PDF-import complaint diagnosed to two root causes (Gantt-view PDF format + stuck AI permission). Mockup → v39.
- **2026-09-29 (session 2, this session):** Large UX feedback batch across several rounds — undo/redo, clear-all-data, drag-to-reorder (redesigned twice — see below), resize-handle/link-knob conflict (found + fixed twice — LL-013, then moved knobs to bottom corners), Transfers/POB freeze (rebuilt from `position:sticky` to a non-sticky frozen container after sticky failed again — LL-015), theme toggle visibility, milestone toggle in the edit drawer, Task/Phase + per-column resize, phase color click-to-set/reset (+ now washes onto task bars, not just swatches), demo-data anonymization (real field/vendor/personal names → fictional), dependency-arrow display bugs found and fixed (phase-collapse not re-anchoring; a stale hardcoded `280px` — LL-014), Dashboard/Analytics built first as a standalone prototype then integrated as a real 5th tab wired to live data (v45), grouping/reordering redesigned for consistency (drag-onto-task always reorders now). See LL-013–LL-015. Mockup → **v46**. Also scoped (not built) what a standalone Electron/Tauri build would cost in setup, effort, and installer size.

---

## Next Steps

1. User verifies v46 in a real browser (see "Immediate next actions" above for the specific things to check).
2. Get the Gantt-view schedule PDF's full extracted text when available; build its dedicated parser.
3. Get an explicit hosted-vs-standalone decision (evidence + this session's Electron/Tauri sizing still leans hosted for the coworker-sharing use case).
4. Send the coworker email invites.
5. Once architecture is settled and mockup scope feels sufficient: fold "Scope Grown Beyond Spec" into `PROJECT_SPEC.md`, then start the real build.

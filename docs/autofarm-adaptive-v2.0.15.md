# AutoFarm Adaptive v2.0.15 — native TWPF integration

AutoFarm Adaptive is integrated as a TWPF feature, not run as the standalone v2.0.14 userscript. The imported v2.0.14.3 algorithms form an inert semantic/parsing core; TWPF owns lifecycle, network policy, scheduling, leases, hard-stop, storage and UI.

## Safe activation

1. Disable the old standalone AutoFarm and wait for its lease to expire.
2. Enable **AutoFarm Adaptive** in TWPF Settings. This only exposes the command deck.
3. Review the model, radius and pacing for the current village.
4. Press **INICIAR**. Automation is disabled independently for every source village until this explicit action.

If old `twaf59:` data exists, the first native initialization takes an immutable snapshot under a migration lease, validates a readback marker, and imports it with `enabled=false`. Original keys are retained. An active old setting, live old lease, corrupt JSON, changed snapshot, wrong account scope or failed IndexedDB transaction aborts migration without enabling or partially publishing the feature.

## Runtime guarantees

- The shared TWPF scheduler is the only wake/timer owner. Plans and tasks survive reloads.
- Every village uses the shared coordinator lease and fencing token.
- One scheduler occurrence can perform at most one Farm Assistant POST.
- The final POST boundary revalidates settings revision, generation, target state, barbarian ownership, template, authoritative composition, troops and proof lifetime.
- `PREPARED` journal entries can be rolled back after a crash. `TRANSMITTING` and `UNKNOWN` entries are never retried blindly; only a later, temporally compatible report can confirm them.
- Explicit no-units responses create a short authoritative zero-capacity proof. Missing or unparsable `current_units` invalidates capacity after a successful mutation.
- CAPTCHA/Bot Protection, same-origin HTTP 403/429 and login loss enter the shared account HARD_STOP. Recovery remains a manual TWPF action.
- Reports are deduplicated by world/player/report ID. Safe AutoFarm matches and external observations both train the model, but external reports cannot consume an AutoFarm pending dispatch.
- Template C is intentionally excluded because it is the game's report/scouting action, not a normal A/B troop template.

## Persistence layout

TWPF IndexedDB schema version 9 adds the following stores:

- `autofarm_meta`: settings, coordination, plans, map presence and migration markers;
- `autofarm_farms`: learned state per target coordinate;
- `autofarm_dispatches`, `autofarm_reports`, `autofarm_events`: canonical measurement ledgers;
- `autofarm_operational`: pending/cooldown target state;
- `autofarm_mutations`: write-ahead mutation journal;
- `autofarm_diagnostics`: bounded diagnostic events.

Writes that join a report to a dispatch and writes that cross the POST boundary use strict IndexedDB transactions. Success is reported only after transaction completion; quota, schema and CAS errors fail closed.

## Validation performed

- Upstream v2.0.14.3 SHA-256 manifest, validator and deterministic harness passed before integration.
- Upstream harness also passed under `Europe/Lisbon` and `Asia/Tokyo`.
- Native migration/CAS/journal/retention harness: 10 cases.
- Native inert-lifecycle/safety harness: module evaluation performs no network, timer loop or listener registration; disabled restored work performs no network.
- TWPF regressions: 41 core runtime, 36 extra building queue, 79 automation and 19 UI tests.
- IndexedDB schema/commit harness: 4 cases.
- Full installed userscript graph evaluates and boots with AutoFarm hidden/stopped by default.
- The browser geometry harness could not run in this environment because no WebDriver endpoint was available at `127.0.0.1:4444`; the non-visual UI regression suite and complete userscript boot harness passed.

No live-world POST is performed by the automated test suite. HTML/API changes made by TribalWars can still require parser updates; unknown evidence always blocks or defers a mutation rather than being guessed.

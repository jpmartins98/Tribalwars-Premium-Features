# AutoFarm Adaptive 2.0.15 — TWPF integration contract

## Ownership

The native controller is split into four boundaries:

- `autoFarmAdaptiveCore.js`: inert parsing/model semantics and shared value normalizers;
- `autoFarmAdaptivePlanner.js`: pure DesiredIntent, stochastic, deadline and authorization decisions;
- `autoFarmAdaptiveStorage.js`: IndexedDB records, migration/handoff, CAS and MutationJournal transactions;
- `autoFarmAdaptive.js`: TWPF scheduler/lease adapter, dependency reads, final gate and command deck.

The TWPF scheduler owns physical wakes. The TWPF coordinator owns leases and fencing between TWPF tabs. The account HARD_STOP dominates all AutoFarm work. The controller never claims it can fence an independent old userscript: its own mutation authority remains disabled while legacy authority is active or unresolved.

## Operational state

`DesiredIntent` records what should be attempted and the persisted stochastic time. Proof TTL is deliberately absent from its timing bounds. Refreshing MAP, ASSISTANT, TEMPLATE, CAPACITY or REPORT data preserves the intent ID, stochastic decision ID and desired timestamp.

`ExecutionRound` is the configured round ceiling. `CapacityProof` is current troop-state authority. A capacity of one therefore authorizes at most one current mutation without changing a round ceiling of 30. A confirmed mutation consumes exactly one round slot and invalidates every pre-mutation capacity proof. Only authoritative response `current_units` can install a replacement `POST_CURRENT_UNITS` proof.

`MutationJournal` crosses these durable states:

1. `PREPARED` and pending target authority are committed before transmission;
2. `TRANSMITTING` and round `UNKNOWN` are committed at the transmission boundary;
3. `CONFIRMED`, `REJECTED`, `NOT_SENT`, or persistent `UNKNOWN` are settled transactionally.

The attempt timestamp is captured before the POST. `PREPARED` is positive evidence that transmission never began. `TRANSMITTING`/`UNKNOWN` never age into `NOT_SENT`. Reconciliation reserves one fresh current report-index GET and optionally one report-detail GET, requires source/target/ID/time/composition compatibility, and performs zero POST.

## Stochastic policy

Both scheduling modes are stochastic operational scheduling, never anti-detection behavior:

- `IMMEDIATE_EFFICIENCY`: early-biased window, normally 15 seconds to 10 minutes;
- `ADAPTIVE_SPREAD`: wider window, normally 30 seconds to 45 minutes.

The anchor is the maximum real lower bound, including `nextMutationNotBeforeAt`. Coalescing profile, temporal profile, stochastic subwindow and exact timestamp are drawn through `RandomSource`; production prefers `crypto.getRandomValues`, while harnesses inject deterministic sources and inspect `drawCount`.

Same semantic intent means the same stochastic decision across reload, report/maintenance wake, proof refresh, manual re-evaluation and lease failover. A confirmed successor in the same execution round is a new intent and gets a new draw. Random waiting itself performs zero network.

## Deadlines and network budget

Coordination persists independent execution, authorization, capacity, report, maintenance, observation, reconciliation and lease-recovery deadlines. The physical scheduler task is armed at their minimum. Processing one reason does not erase the others.

The ordinary REPORT occurrence has a total budget of six report GETs. UNKNOWN reconciliation is separate and takes priority with exactly one fresh index GET plus zero or one detail GET. The final gate is local-only: stale dependencies schedule a dependency-specific wake and produce zero POST.

## Storage and migration

IndexedDB schema version 9 contains:

- `autofarm_meta` — settings, coordination, deadlines, DesiredIntent and migration/handoff records;
- `autofarm_farms` — one learned record per target;
- `autofarm_dispatches`, `autofarm_reports`, `autofarm_events` — canonical ledgers;
- `autofarm_operational` — target pending/cooldown state;
- `autofarm_mutations` — crash-consistent MutationJournal;
- `autofarm_diagnostics` — bounded telemetry.

Critical metadata writes return `WRITTEN` or `UNCHANGED`; CAS conflict is a stale-writer outcome, and failure is fail-closed. Dispatch/report/farm updates are record-level rather than a serialized whole-model blob.

Legacy migration uses `DISCOVERED → MIGRATING → VERIFIED → LEGACY_CLEANED`, with `FAILED` represented as an explicit migration error. Identity includes world, player, source village and fingerprint. Cleanup requires VERIFIED plus explicit handoff, removes only known unchanged keys, and preserves unknown data. Recreated known keys return to discovery/blocking. Historical legacy data alone does not permanently block after a verified handoff; new active/ambiguous authority does.

## Safety status

Automated fixtures confirm: lexical Tampermonkey settings boot, visible STARTING shell, independent deadlines, stochastic persistence/draw counts, current at-home troop authority, one POST for three TWPF tabs, mutation crash states, 403 HARD_STOP provenance/zero retry, UNKNOWN evidence matching, report budgets, IndexedDB blocked/versionchange behavior and the existing TWPF lifecycle suite.

No live Tribal Wars mutation was used for validation. HTML/API compatibility and coexistence with an unobservable external standalone are not proven live.

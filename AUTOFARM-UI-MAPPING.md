# AutoFarm 2.0.15 UI parity mapping

The native TWPF command deck is mounted before asynchronous migration/storage work. A failure changes its status; it does not remove the panel.

## Status precedence

| Priority | Native state | User-visible meaning |
|---:|---|---|
| 1 | `HARD_STOP` | Account protection/network stop; zero AutoFarm GET/POST |
| 2 | `STORAGE_ERROR`, `MIGRATION_ERROR` | Critical persistence or migration failure; fail-closed |
| 3 | `LEGACY_AUTOFARM_DETECTED`, `LEGACY_HANDOFF_REQUIRED`, `MIGRATION_BLOCKED` | TWPF mutations disabled until safe handoff |
| 4 | `UNKNOWN`, `RECONCILING` | Transmission outcome requires evidence; zero POST |
| 5 | `WAITING_LEASE` | Another TWPF tab owns the lease |
| 6 | `EXECUTING` | One authorized mutation occurrence is active |
| 7 | `STARTING`, `OFF`, `WAITING`, `WAITING_EXECUTION`, `WAITING_AUTHORIZATION`, `WAITING_CAPACITY`, `WAITING_REPORT`, `SOFT_PAUSED` | Ordinary local/scheduled lifecycle |

## Surface mapping

| Standalone surface | Native TWPF surface | Mapping | Notes |
|---|---|---|---|
| Command deck shell and A/B selector | Native fixed command deck | `MIGRATED` | Mounted synchronously in `STARTING` |
| Radius, pacing, round limit | Settings pane | `MIGRATED` | Per source village |
| Adaptive/legacy ranking selector | Settings pane | `MIGRATED` | Learning remains active in both modes |
| Stochastic mode | Settings pane + intent diagnostics | `MIGRATED` | Desired time is persisted independently of proof TTL |
| Countdown/scheduling | Intent and independent deadlines panels | `REPLACED_BY_TWPF_EQUIVALENT` | Shared TWPF scheduler replaces the standalone timer |
| Local tab lease | TWPF coordinator lease/fencing | `REPLACED_BY_TWPF_EQUIVALENT` | Exclusivity is proven only between TWPF tabs |
| Local anti-bot watcher/hard stop | Account-wide TWPF Bot Protection/HARD_STOP | `REPLACED_BY_TWPF_EQUIVALENT` | Provenance is retained; 403/429 have zero retry |
| localStorage adaptive blob | IndexedDB record stores | `REPLACED_BY_TWPF_EQUIVALENT` | Farm/report/dispatch writes are O(1) records |
| Pending/sending safety state | IndexedDB operational record + MutationJournal | `MERGED` | Transmission ambiguity survives reload |
| Capacity display | CapacityProof summary | `MERGED` | Separates current authority from round ceiling |
| Queue/coverage counters | Native KPI/model panes | `MIGRATED` | Derived from persisted records |
| Report/model ranking | Native model table | `MIGRATED` | Canonical reports and per-farm records |
| Diagnostics/network telemetry | Native logs/intent/deadlines | `MERGED` | Includes stochastic identity and lateness fields |
| “Reavaliar agora” acceleration | Dependency-only re-evaluation | `REPLACED_BY_TWPF_EQUIVALENT` | Never accelerates or redraws a valid DesiredIntent |
| Standalone start while legacy authority is ambiguous | Explicit handoff control | `REPLACED_BY_TWPF_EQUIVALENT` | TWPF remains read-only until verified handoff |
| Template C automation | None | `NOT_APPLICABLE` | C is the game's scouting/report action, not an A/B troop template |
| CAPTCHA solving/evasion controls | None | `NOT_APPLICABLE` | Explicitly prohibited; detection enters HARD_STOP |
| Human-imitation/anti-detection timing | None | `NOT_APPLICABLE` | Stochastic policy is only operational scheduling/load spreading |

The UI exposes the intent ID, stochastic decision, profile, desired time and RNG draw count. Refreshing proofs, REPORT wakes, reloads and manual re-evaluation retain those fields for the same semantic intent.

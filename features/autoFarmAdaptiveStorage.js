// Native AutoFarm migration boundary. This module has no timers, network calls or
// farming side effects; importing an old snapshot never enables automation.
(function (root) {
    'use strict';

    const LEGACY_NAMESPACE = 'twaf59:';
    const SNAPSHOT_TYPE = 'legacySnapshot';
    const MARKER_TYPE = 'legacyMigration';

    function migrationError(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    function normalizeScope(input, host) {
        const world = String(input?.world || host.location?.host || '');
        const playerId = String(input?.playerId || host.game_data?.player?.id || '');
        const sourceVillageId = String(input?.sourceVillageId || '');
        if (!world || !playerId || !sourceVillageId ||
            [world, playerId, sourceVillageId].some(value => value === 'undefined' || value === 'null')) {
            throw migrationError('AUTOFARM_SCOPE_MISSING', 'AutoFarm migration requires world, player and source village');
        }
        if (world !== String(host.location?.host || '') ||
            playerId !== String(host.game_data?.player?.id || '')) {
            throw migrationError('AUTOFARM_SCOPE_MISMATCH', 'AutoFarm migration scope differs from the current account');
        }
        return { world, playerId, sourceVillageId };
    }

    function parseLegacyJson(raw, key) {
        if (raw === null) return null;
        try { return JSON.parse(raw); }
        catch (_) { throw migrationError('AUTOFARM_LEGACY_CORRUPT', 'Invalid legacy JSON: ' + key); }
    }

    function readLegacySnapshot(scope, options = {}) {
        const host = options.host || root;
        const storage = options.storage || host.localStorage;
        const now = options.now || Date.now;
        if (!storage || typeof storage.getItem !== 'function') {
            throw migrationError('AUTOFARM_LEGACY_UNAVAILABLE', 'Legacy localStorage is unavailable');
        }
        const context = normalizeScope(scope, host);
        const prefix = `${LEGACY_NAMESPACE}${context.world}:p${context.playerId}:v${context.sourceVillageId}:`;
        const entries = {};
        let hardStopRaw;
        try {
            for (let i = 0; i < storage.length; i++) {
                const key = String(storage.key(i) || '');
                if (key.startsWith(prefix)) {
                    const raw = storage.getItem(key);
                    if (raw !== null) entries[key.slice(prefix.length)] = raw;
                }
            }
            hardStopRaw = storage.getItem(`${LEGACY_NAMESPACE}${context.world}:p${context.playerId}:accountHardStop`);
        } catch (_) {
            throw migrationError('AUTOFARM_LEGACY_READ_FAILED', 'Could not read the complete legacy AutoFarm snapshot');
        }
        const settings = parseLegacyJson(entries.settings ?? null, 'settings');
        const oldLease = parseLegacyJson(entries.lease ?? null, 'lease');
        const accountHardStop = parseLegacyJson(hardStopRaw, 'accountHardStop');
        if (settings?.enabled === true || Number(oldLease?.expiresAt || 0) > now()) {
            throw migrationError(
                'AUTOFARM_LEGACY_ACTIVE',
                'Disable the standalone AutoFarm and wait for its lease to finish before migration'
            );
        }
        return {
            ...context,
            sourceFormat: 'twaf59-v2.0.14.x',
            capturedAt: now(),
            entries,
            accountHardStopRaw: hardStopRaw,
            accountHardStopActive: accountHardStop?.active === true,
            entryCount: Object.keys(entries).length
        };
    }

    function validateStoredSnapshot(marker, snapshot) {
        if (!marker || !snapshot || !['SNAPSHOT_CAPTURED', 'IMPORTED'].includes(marker.status) ||
            !snapshot.entries || typeof snapshot.entries !== 'object' ||
            Number(marker.entryCount) !== Object.keys(snapshot.entries).length ||
            marker.capturedAt !== snapshot.capturedAt ||
            ['world', 'playerId', 'sourceVillageId'].some(key => marker[key] !== snapshot[key])) {
            throw migrationError('AUTOFARM_MIGRATION_INCOMPLETE', 'Legacy AutoFarm snapshot and migration marker disagree');
        }
        return { status: marker.status, marker, snapshot };
    }

    function createAutoFarmStorage(options = {}) {
        const host = options.host || root;
        const storage = options.storage || host.localStorage;
        const now = options.now || Date.now;
        const coordination = options.coordination || host.PremiumFeaturesCoordination;
        const transact = options.transact || host.runAutoFarmDbTransaction ||
            (typeof runAutoFarmDbTransaction === 'function' ? runAutoFarmDbTransaction : null);

        function readCapturedSnapshot(scope) {
            const context = normalizeScope(scope, host);
            if (typeof transact !== 'function') {
                return Promise.reject(migrationError('AUTOFARM_IDB_UNAVAILABLE', 'Strict IndexedDB transaction API is unavailable'));
            }
            return transact(['autofarm_meta'], 'readonly', api => {
                const store = api.store('autofarm_meta');
                const base = [context.world, context.playerId, context.sourceVillageId];
                api.onRequest(store.get([...base, MARKER_TYPE]), marker => {
                    if (!marker) {
                        api.setResult({ status: 'NOT_CAPTURED' });
                        return;
                    }
                    api.onRequest(store.get([...base, SNAPSHOT_TYPE]), snapshot => {
                        api.setResult(validateStoredSnapshot(marker, snapshot));
                    });
                });
            });
        }

        function readRecord(storeName, key) {
            if (typeof transact !== 'function') {
                return Promise.reject(migrationError('AUTOFARM_IDB_UNAVAILABLE', 'Strict IndexedDB transaction API is unavailable'));
            }
            return transact([storeName], 'readonly', api => {
                api.onRequest(api.store(storeName).get(key), value => api.setResult(value ?? null));
            });
        }

        function readIndex(storeName, indexName, key) {
            return transact([storeName], 'readonly', api => {
                const index = api.store(storeName).index(indexName);
                api.onRequest(index.getAll(key), value => api.setResult(Array.isArray(value) ? value : []));
            });
        }

        function putRecords(storeName, records, guard = null) {
            const list = Array.isArray(records) ? records : [];
            return transact([storeName], 'readwrite', api => {
                const store = api.store(storeName);
                guard?.assertActive?.();
                for (const record of list) api.onRequest(store.put(record));
                api.setResult({ count: list.length });
            });
        }

        function appendDiagnostic(scope, entry, limit = 240) {
            const context = normalizeScope(scope, host);
            const maxEntries = Math.max(20, Math.trunc(Number(limit) || 240));
            const record = {
                ...context,
                ...entry,
                eventId: String(entry?.eventId || `${context.sourceVillageId}:${now()}`),
                at: Math.max(0, Number(entry?.at) || now())
            };
            return transact(['autofarm_diagnostics'], 'readwrite', api => {
                const store = api.store('autofarm_diagnostics');
                const index = store.index('by_village');
                api.onRequest(index.getAll([context.world, context.playerId, context.sourceVillageId]), existing => {
                    const rows = [...(Array.isArray(existing) ? existing : []), record]
                        .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
                    api.onRequest(store.put(record));
                    for (const stale of rows.slice(0, Math.max(0, rows.length - maxEntries))) {
                        if (String(stale.eventId) !== record.eventId) api.onRequest(store.delete(stale.eventId));
                    }
                    api.setResult(record);
                });
            });
        }

        function putMetaCas(scope, recordType, expectedRevision, value, guard = null) {
            const context = normalizeScope(scope, host);
            const key = [context.world, context.playerId, context.sourceVillageId, String(recordType)];
            return transact(['autofarm_meta'], 'readwrite', api => {
                const store = api.store('autofarm_meta');
                api.onRequest(store.get(key), previous => {
                    guard?.assertActive?.();
                    const revision = Math.max(0, Number(previous?.revision) || 0);
                    if (expectedRevision !== null && expectedRevision !== undefined && revision !== Number(expectedRevision)) {
                        throw migrationError('AUTOFARM_CAS_MISMATCH', `Expected revision ${expectedRevision}, found ${revision}`);
                    }
                    const next = {
                        ...context,
                        recordType: String(recordType),
                        revision: revision + 1,
                        updatedAt: now(),
                        value
                    };
                    api.onRequest(store.put(next), () => api.setResult(next));
                });
            });
        }

        function mutationContext(scope) {
            const context = normalizeScope(scope, host);
            const base = [context.world, context.playerId, context.sourceVillageId];
            return { context, base };
        }

        function prepareMutation(scope, input, guard) {
            const { context, base } = mutationContext(scope);
            const mutationId = String(input?.mutationId || '');
            if (!mutationId || !input?.targetCoord || !input?.targetId || !input?.templateId) {
                return Promise.reject(migrationError('AUTOFARM_MUTATION_INVALID', 'Mutation identity is incomplete'));
            }
            return transact(['autofarm_meta', 'autofarm_operational', 'autofarm_mutations'], 'readwrite', api => {
                const meta = api.store('autofarm_meta');
                const operational = api.store('autofarm_operational');
                const mutations = api.store('autofarm_mutations');
                api.onRequest(meta.get([...base, 'settings']), settingsRecord => {
                    guard?.assertActive?.();
                    if (!settingsRecord?.value?.enabled) {
                        throw migrationError('AUTOFARM_DISABLED', 'AutoFarm was disabled before mutation preparation');
                    }
                    if (Number(settingsRecord.revision) !== Number(input.settingsRevision)) {
                        throw migrationError('AUTOFARM_CAS_MISMATCH', 'Settings revision changed before mutation');
                    }
                    api.onRequest(meta.get([...base, 'coordination']), coordinationRecord => {
                        guard?.assertActive?.();
                        if (!coordinationRecord || Number(coordinationRecord.revision) !== Number(input.coordinationRevision)) {
                            throw migrationError('AUTOFARM_CAS_MISMATCH', 'Coordination revision changed before mutation');
                        }
                        const coordinationValue = coordinationRecord.value || {};
                        if (coordinationValue.state === 'UNKNOWN' || coordinationValue.executionRound?.pendingMutation) {
                            throw migrationError('AUTOFARM_UNKNOWN_PENDING', 'A previous mutation still requires reconciliation');
                        }
                        api.onRequest(mutations.get(mutationId), existing => {
                            if (existing) {
                                throw migrationError('AUTOFARM_MUTATION_DUPLICATE', 'Mutation id already exists');
                            }
                            api.onRequest(operational.get([...base, 'targetStates']), targetRecord => {
                                guard?.assertActive?.();
                                const targetStates = { ...(targetRecord?.value || {}) };
                                const previousTarget = targetStates[input.targetCoord] || {};
                                if (previousTarget.pending || previousTarget.sending) {
                                    throw migrationError('AUTOFARM_TARGET_PENDING', 'Target already has a pending mutation');
                                }
                                targetStates[input.targetCoord] = {
                                    ...previousTarget,
                                    sending: true,
                                    sendingAt: now(),
                                    sendingMutationId: mutationId
                                };
                                const targetNext = {
                                    ...context,
                                    recordType: 'targetStates',
                                    revision: Math.max(0, Number(targetRecord?.revision) || 0) + 1,
                                    updatedAt: now(),
                                    value: targetStates
                                };
                                const record = {
                                    ...context,
                                    ...input,
                                    mutationId,
                                    status: 'PREPARED',
                                    preparedAt: now(),
                                    fencingToken: Number(guard?.token) || null
                                };
                                api.onRequest(operational.put(targetNext));
                                api.onRequest(mutations.put(record));
                                api.setResult(record);
                            });
                        });
                    });
                });
            });
        }

        function markMutationTransmitting(scope, mutationId, guard) {
            const { context } = mutationContext(scope);
            return transact(['autofarm_mutations'], 'readwrite', api => {
                const store = api.store('autofarm_mutations');
                api.onRequest(store.get(String(mutationId)), record => {
                    guard?.assertActive?.();
                    if (!record || record.status !== 'PREPARED' ||
                        (record.fencingToken !== null && Number(record.fencingToken) !== Number(guard?.token))) {
                        throw migrationError('AUTOFARM_MUTATION_FENCED', 'Prepared mutation no longer belongs to this lease');
                    }
                    const next = { ...record, ...context, status: 'TRANSMITTING', transmittedAt: now() };
                    api.onRequest(store.put(next), () => api.setResult(next));
                });
            });
        }

        function settleMutation(scope, mutationId, outcome, details, guard) {
            const { context, base } = mutationContext(scope);
            const result = String(outcome || '').toUpperCase();
            if (!['CONFIRMED', 'REJECTED', 'UNKNOWN', 'NOT_SENT'].includes(result)) {
                return Promise.reject(migrationError('AUTOFARM_MUTATION_INVALID', 'Unknown mutation outcome'));
            }
            const stores = ['autofarm_meta', 'autofarm_operational', 'autofarm_mutations', 'autofarm_dispatches'];
            return transact(stores, 'readwrite', api => {
                const mutations = api.store('autofarm_mutations');
                const operational = api.store('autofarm_operational');
                const meta = api.store('autofarm_meta');
                api.onRequest(mutations.get(String(mutationId)), record => {
                    guard?.assertActive?.();
                    if (!record) throw migrationError('AUTOFARM_MUTATION_MISSING', 'Mutation journal entry is missing');
                    if (record.status === 'CONFIRMED' && result === 'CONFIRMED') {
                        api.setResult(record);
                        return;
                    }
                    if (!['PREPARED', 'TRANSMITTING', 'UNKNOWN'].includes(record.status)) {
                        throw migrationError('AUTOFARM_MUTATION_FINAL', 'Mutation already has a terminal outcome');
                    }
                    api.onRequest(operational.get([...base, 'targetStates']), targetRecord => {
                        const targetStates = { ...(targetRecord?.value || {}) };
                        const previousTarget = targetStates[record.targetCoord] || {};
                        const settledAt = now();
                        const reportConfirmed = result === 'CONFIRMED' && Boolean(details?.reportId);
                        const targetNext = result === 'CONFIRMED'
                            ? {
                                ...previousTarget, sending: false, sendingAt: 0, sendingMutationId: null,
                                pending: !reportConfirmed, uncertain: false,
                                sentAt: Number(record.transmittedAt || record.preparedAt) || settledAt,
                                pendingMutationId: reportConfirmed ? null : record.mutationId,
                                reportIdAtSend: record.reportIdAtSend || null,
                                lastReportId: reportConfirmed ? String(details.reportId) : previousTarget.lastReportId,
                                lastResult: reportConfirmed ? 'report-confirmed' : 'sent-confirmed',
                                cooldownUntil: reportConfirmed ? settledAt + 30 * 60000 : Number(previousTarget.cooldownUntil || 0)
                            }
                            : result === 'UNKNOWN'
                                ? {
                                    ...previousTarget, sending: false, pending: true,
                                    uncertain: true, sentAt: record.transmittedAt || settledAt,
                                    pendingMutationId: record.mutationId
                                }
                                : {
                                    ...previousTarget, sending: false, sendingAt: 0,
                                    sendingMutationId: null
                                };
                        targetStates[record.targetCoord] = targetNext;
                        api.onRequest(operational.put({
                            ...context,
                            recordType: 'targetStates',
                            revision: Math.max(0, Number(targetRecord?.revision) || 0) + 1,
                            updatedAt: settledAt,
                            value: targetStates
                        }));
                        api.onRequest(meta.get([...base, 'coordination']), coordinationRecord => {
                            const value = { ...(coordinationRecord?.value || {}) };
                            const round = { ...(value.executionRound || {}) };
                            if (result === 'CONFIRMED') {
                                round.dispatchLimitRemaining = Math.max(0, Number(round.dispatchLimitRemaining || 0) - 1);
                                round.status = round.dispatchLimitRemaining > 0 ? 'OPEN' : 'EXHAUSTED';
                                round.pendingMutation = null;
                                value.state = round.status === 'OPEN' ? 'WAITING_EXECUTION' : 'WAITING_WORK';
                                api.onRequest(api.store('autofarm_dispatches').put({
                                    ...context,
                                    dispatchId: String(record.dispatchId || record.mutationId),
                                    targetCoord: record.targetCoord,
                                    targetId: record.targetId,
                                    templateId: record.templateId,
                                    farmTemplate: record.farmTemplate,
                                    executionRoundId: record.executionRoundId,
                                    status: reportConfirmed ? 'MATCHED' : 'PENDING',
                                    trackable: true,
                                    sentAt: Number(record.transmittedAt || record.preparedAt) || settledAt,
                                    reportIdAtSend: record.reportIdAtSend || null,
                                    reportIdMatched: reportConfirmed ? String(details.reportId) : null,
                                    matchedAt: reportConfirmed ? settledAt : 0,
                                    prediction: record.prediction || null,
                                    composition: record.composition || null,
                                    capacity: record.capacity ?? null
                                }));
                            } else if (result === 'UNKNOWN') {
                                round.status = 'UNKNOWN';
                                round.pendingMutation = { mutationId: record.mutationId, at: settledAt };
                                value.state = 'UNKNOWN';
                            } else {
                                round.pendingMutation = null;
                                value.state = 'WAITING_WORK';
                            }
                            value.executionRound = round;
                            api.onRequest(meta.put({
                                ...context,
                                recordType: 'coordination',
                                revision: Math.max(0, Number(coordinationRecord?.revision) || 0) + 1,
                                updatedAt: settledAt,
                                value
                            }));
                            const next = {
                                ...record,
                                status: result,
                                settledAt,
                                details: details || null
                            };
                            api.onRequest(mutations.put(next), () => api.setResult(next));
                        });
                    });
                });
            });
        }

        function confirmPendingReport(scope, input, guard) {
            const { context, base } = mutationContext(scope);
            const coord = String(input?.targetCoord || '');
            const reportId = String(input?.reportId || '');
            if (!coord || !reportId) {
                return Promise.reject(migrationError('AUTOFARM_REPORT_INVALID', 'Report identity is incomplete'));
            }
            return transact(['autofarm_operational', 'autofarm_dispatches', 'autofarm_reports'], 'readwrite', api => {
                const operational = api.store('autofarm_operational');
                const reports = api.store('autofarm_reports');
                const dispatches = api.store('autofarm_dispatches');
                api.onRequest(operational.get([...base, 'targetStates']), targetRecord => {
                    guard?.assertActive?.();
                    const targetStates = { ...(targetRecord?.value || {}) };
                    const previous = targetStates[coord] || {};
                    if (!previous.pending || String(previous.pendingMutationId || '') !== String(input.dispatchId || '')) {
                        api.setResult({ status: 'STALE_PENDING' });
                        return;
                    }
                    const observedAt = Math.max(0, Number(input.observedAt) || 0);
                    const processedAt = now();
                    targetStates[coord] = {
                        ...previous,
                        pending: false,
                        sending: false,
                        uncertain: false,
                        pendingMutationId: null,
                        lastReportId: reportId,
                        lastResult: String(input.resultKind || 'report-confirmed'),
                        cooldownUntil: Math.max(processedAt, Number(input.cooldownUntil) || processedAt)
                    };
                    api.onRequest(operational.put({
                        ...context, recordType: 'targetStates',
                        revision: Math.max(0, Number(targetRecord?.revision) || 0) + 1,
                        updatedAt: processedAt, value: targetStates
                    }));
                    api.onRequest(reports.get([context.world, context.playerId, reportId]), existingReport => {
                        if (!existingReport) {
                            api.onRequest(reports.put({
                                ...context, reportId, targetCoord: coord,
                                timestamp: observedAt || null, recordedAt: processedAt,
                                detailState: 'ASSISTANT_SUMMARY', quantitative: false,
                                attribution: 'AUTO_MATCHED', dispatchId: String(input.dispatchId),
                                haul: String(input.haul || 'unknown'), dot: String(input.dot || 'unknown'),
                                source: 'assistant-summary'
                            }));
                        }
                        api.onRequest(dispatches.get(String(input.dispatchId)), dispatch => {
                            if (dispatch) {
                                api.onRequest(dispatches.put({
                                    ...dispatch, status: 'MATCHED', reportIdMatched: reportId,
                                    matchedAt: processedAt
                                }));
                            }
                            api.setResult({ status: 'MATCHED', reportId, targetCoord: coord });
                        });
                    });
                });
            });
        }

        function commitLearnedReport(scope, input, guard) {
            const { context, base } = mutationContext(scope);
            const report = input?.report;
            const farm = input?.farm;
            const coord = String(report?.targetCoord || farm?.coord || '');
            const reportId = String(report?.reportId || '');
            if (!coord || !reportId || !farm) {
                return Promise.reject(migrationError('AUTOFARM_REPORT_INVALID', 'Learned report is incomplete'));
            }
            const names = [
                'autofarm_farms', 'autofarm_reports', 'autofarm_events',
                'autofarm_operational', 'autofarm_dispatches'
            ];
            return transact(names, 'readwrite', api => {
                const reports = api.store('autofarm_reports');
                const operational = api.store('autofarm_operational');
                api.onRequest(reports.get([context.world, context.playerId, reportId]), existing => {
                    guard?.assertActive?.();
                    if (existing && String(existing.detailState || '') !== 'ASSISTANT_SUMMARY') {
                        api.setResult({ status: 'DUPLICATE', report: existing });
                        return;
                    }
                    const timestamp = now();
                    api.onRequest(api.store('autofarm_farms').put({
                        ...context, targetCoord: coord,
                        updatedAt: Number(farm.updatedAt || farm.lastModelUpdateAt) || timestamp,
                        value: farm
                    }));
                    api.onRequest(reports.put({ ...report, ...context, reportId, targetCoord: coord }));
                    if (input.event) {
                        api.onRequest(api.store('autofarm_events').put({
                            ...input.event, ...context,
                            eventId: String(input.event.eventId || `${context.sourceVillageId}:${reportId}`),
                            targetCoord: coord
                        }));
                    }
                    api.onRequest(operational.get([...base, 'targetStates']), targetRecord => {
                        const states = { ...(targetRecord?.value || {}) };
                        const previous = states[coord] || {};
                        const matched = Boolean(input.matchedDispatchId);
                        if (matched || !previous.pending) {
                            states[coord] = {
                                ...previous,
                                assistantEverSeen: true,
                                lastReportId: reportId,
                                lastResult: String(input.resultKind || 'report-observed'),
                                cooldownUntil: Math.max(timestamp, Number(input.cooldownUntil) || timestamp),
                                ...(matched ? {
                                    pending: false, sending: false, uncertain: false,
                                    pendingMutationId: null, sendingMutationId: null
                                } : {})
                            };
                            api.onRequest(operational.put({
                                ...context, recordType: 'targetStates',
                                revision: Math.max(0, Number(targetRecord?.revision) || 0) + 1,
                                updatedAt: timestamp, value: states
                            }));
                        }
                        if (!matched) {
                            api.setResult({ status: 'COMMITTED', matched: false, reportId });
                            return;
                        }
                        api.onRequest(api.store('autofarm_dispatches').get(String(input.matchedDispatchId)), dispatch => {
                            if (dispatch) {
                                api.onRequest(api.store('autofarm_dispatches').put({
                                    ...dispatch, status: dispatch.status === 'EXPIRED' ? 'LATE_MATCHED' : 'MATCHED',
                                    reportIdMatched: reportId, matchedAt: timestamp,
                                    loot: report.loot ?? null,
                                    observedCapacity: report.capacity ?? null
                                }));
                            }
                            api.setResult({ status: 'COMMITTED', matched: true, reportId });
                        });
                    });
                });
            });
        }

        function legacyJson(snapshot, name, fallback) {
            const raw = snapshot?.entries?.[name];
            const parsed = parseLegacyJson(raw ?? null, name);
            return parsed === null ? fallback : parsed;
        }

        function legacyRecords(snapshot) {
            const core = host.PremiumFeaturesAutoFarmAdaptiveCore || {};
            const context = {
                world: snapshot.world,
                playerId: snapshot.playerId,
                sourceVillageId: snapshot.sourceVillageId
            };
            const at = now();
            const rawSettings = legacyJson(snapshot, 'settings', {});
            const settings = typeof core.normalizeCfg === 'function'
                ? core.normalizeCfg({ ...rawSettings, enabled: false })
                : { ...rawSettings, enabled: false };
            settings.enabled = false;
            const rawCoordination = legacyJson(snapshot, 'coordinationV2', {});
            const coordinationState = typeof core.normalizeCoordinationState === 'function'
                ? core.normalizeCoordinationState(rawCoordination)
                : { ...rawCoordination };
            coordinationState.state = 'DISABLED';
            coordinationState.ownerId = '';
            coordinationState.nextWakeAt = 0;
            coordinationState.executionDueAt = 0;
            coordinationState.executionPlan = null;
            coordinationState.stochasticPlan = null;
            coordinationState.reason = 'imported-disabled';
            const adaptive = legacyJson(snapshot, 'adaptiveV2', {});
            const metaValues = {
                settings,
                coordination: coordinationState,
                mapPresence: legacyJson(snapshot, 'mapPresenceV2', null),
                visualScan: legacyJson(snapshot, 'visualScanV2', null),
                templateCompositions: legacyJson(snapshot, 'templateCompositions', {}),
                modelMeta: adaptive && typeof adaptive === 'object' ? Object.fromEntries(
                    Object.entries(adaptive).filter(([key]) => !['farms', 'events', 'dispatches', 'reportLedger'].includes(key))
                ) : {}
            };
            const operationalValues = {
                targetStates: legacyJson(snapshot, 'targets', {}),
                targetCoords: legacyJson(snapshot, 'dynamicTargets', []),
                cursor: legacyJson(snapshot, 'cursor', 0)
            };
            const farms = Object.entries(adaptive?.farms || {}).map(([targetCoord, value]) => ({
                ...context, targetCoord: String(targetCoord), updatedAt: Number(value?.updatedAt) || at, value
            }));
            const dispatches = (Array.isArray(adaptive?.dispatches) ? adaptive.dispatches : []).map((raw, index) => {
                const value = typeof core.normalizeAdaptiveDispatch === 'function'
                    ? core.normalizeAdaptiveDispatch(raw, context.sourceVillageId)
                    : { ...raw };
                return { ...value, ...context, dispatchId: String(value.dispatchId || `legacy:${context.sourceVillageId}:${index}`) };
            });
            const reports = (Array.isArray(adaptive?.reportLedger) ? adaptive.reportLedger : []).map((raw, index) => {
                const value = typeof core.normalizeAdaptiveReportLedgerEntry === 'function'
                    ? core.normalizeAdaptiveReportLedgerEntry(raw, context.sourceVillageId)
                    : { ...raw };
                return {
                    ...value, ...context,
                    reportId: String(value.reportId || `legacy-${index}`),
                    targetCoord: String(value.targetCoord || value.coord || ''),
                    timestamp: Number(value.timestamp || value.observedAt) || 0
                };
            });
            const events = (Array.isArray(adaptive?.events) ? adaptive.events : []).map((raw, index) => {
                const value = typeof core.normalizeAdaptiveEvent === 'function'
                    ? core.normalizeAdaptiveEvent(raw, context.sourceVillageId)
                    : { ...raw };
                return {
                    ...value, ...context,
                    eventId: String(value.eventId || value.reportId || `legacy:${context.sourceVillageId}:${index}`),
                    targetCoord: String(value.targetCoord || value.coord || ''),
                    at: Number(value.at || value.timestamp) || 0
                };
            });
            const diagnostics = (Array.isArray(legacyJson(snapshot, 'networkLedgerV2', []))
                ? legacyJson(snapshot, 'networkLedgerV2', []).slice(-60)
                : []).map((value, index) => ({
                    ...context,
                    eventId: String(value?.occurrenceId || `legacy-network:${context.sourceVillageId}:${index}`),
                    at: Number(value?.startedAt || value?.finishedAt) || at,
                    kind: 'LEGACY_NETWORK',
                    value
                }));
            return { context, metaValues, operationalValues, farms, dispatches, reports, events, diagnostics };
        }

        async function materializeLegacySnapshot(scope) {
            const context = normalizeScope(scope, host);
            if (typeof coordination?.runWithLease !== 'function' || typeof transact !== 'function') {
                throw migrationError('AUTOFARM_MIGRATION_UNAVAILABLE', 'Native lease and strict IndexedDB are required');
            }
            const taskKey = `autofarm:migration:${context.world}:p${context.playerId}:v${context.sourceVillageId}`;
            return coordination.runWithLease(taskKey, async guard => {
                guard.assertActive();
                const captured = await readCapturedSnapshot(context);
                if (captured.status === 'NOT_CAPTURED') return { status: 'NOT_CAPTURED' };
                if (captured.status === 'IMPORTED') return captured;
                const records = legacyRecords(captured.snapshot);
                const names = [
                    'autofarm_meta', 'autofarm_farms', 'autofarm_dispatches', 'autofarm_reports',
                    'autofarm_events', 'autofarm_operational', 'autofarm_diagnostics'
                ];
                await transact(names, 'readwrite', api => {
                    const meta = api.store('autofarm_meta');
                    const operational = api.store('autofarm_operational');
                    const markerKey = [context.world, context.playerId, context.sourceVillageId, MARKER_TYPE];
                    api.onRequest(meta.get(markerKey), marker => {
                        guard.assertActive();
                        if (!marker || marker.status !== 'SNAPSHOT_CAPTURED') {
                            throw migrationError('AUTOFARM_MIGRATION_INCOMPLETE', 'Migration marker is not ready to import');
                        }
                        for (const [recordType, value] of Object.entries(records.metaValues)) {
                            api.onRequest(meta.put({ ...context, recordType, revision: 1, updatedAt: now(), value }));
                        }
                        for (const [recordType, value] of Object.entries(records.operationalValues)) {
                            api.onRequest(operational.put({ ...context, recordType, revision: 1, updatedAt: now(), value }));
                        }
                        for (const record of records.farms) api.onRequest(api.store('autofarm_farms').put(record));
                        for (const record of records.dispatches) api.onRequest(api.store('autofarm_dispatches').put(record));
                        for (const record of records.reports) api.onRequest(api.store('autofarm_reports').put(record));
                        for (const record of records.events) api.onRequest(api.store('autofarm_events').put(record));
                        for (const record of records.diagnostics) api.onRequest(api.store('autofarm_diagnostics').put(record));
                        api.onRequest(meta.put({
                            ...marker,
                            status: 'IMPORTED',
                            importedAt: now(),
                            revision: Math.max(1, Number(marker.revision) || 1) + 1,
                            importedCounts: Object.fromEntries(
                                ['farms', 'dispatches', 'reports', 'events', 'diagnostics'].map(name => [name, records[name].length])
                            )
                        }));
                    });
                });
                guard.assertActive();
                const verified = await readCapturedSnapshot(context);
                if (verified.status !== 'IMPORTED') {
                    throw migrationError('AUTOFARM_MIGRATION_INCOMPLETE', 'Imported marker could not be verified');
                }
                return verified;
            }, { ttlMs: 60000 });
        }

        async function migrateLegacySnapshot(scope) {
            const context = normalizeScope(scope, host);
            if (typeof coordination?.runWithLease !== 'function' || typeof transact !== 'function') {
                throw migrationError('AUTOFARM_MIGRATION_UNAVAILABLE', 'Native lease and strict IndexedDB are required');
            }
            const taskKey = `autofarm:migration:${context.world}:p${context.playerId}:v${context.sourceVillageId}`;
            return coordination.runWithLease(taskKey, async guard => {
                guard.assertActive();
                const snapshot = readLegacySnapshot(context, { host, storage, now });
                if (!snapshot.entryCount && snapshot.accountHardStopRaw === null) {
                    return { status: 'NO_LEGACY_DATA' };
                }
                const base = [context.world, context.playerId, context.sourceVillageId];
                const marker = {
                    ...context,
                    recordType: MARKER_TYPE,
                    status: 'SNAPSHOT_CAPTURED',
                    sourceFormat: snapshot.sourceFormat,
                    capturedAt: snapshot.capturedAt,
                    entryCount: snapshot.entryCount,
                    accountHardStopActive: snapshot.accountHardStopActive,
                    revision: 1
                };
                const snapshotRecord = { ...snapshot, recordType: SNAPSHOT_TYPE };
                const outcome = await transact(['autofarm_meta'], 'readwrite', api => {
                    const store = api.store('autofarm_meta');
                    api.onRequest(store.get([...base, MARKER_TYPE]), existing => {
                        guard.assertActive();
                        const latest = readLegacySnapshot(context, { host, storage, now });
                        if (JSON.stringify(latest.entries) !== JSON.stringify(snapshot.entries) ||
                            latest.accountHardStopRaw !== snapshot.accountHardStopRaw) {
                            throw migrationError('AUTOFARM_LEGACY_CHANGED', 'Legacy AutoFarm changed during snapshot capture');
                        }
                        if (existing) {
                            api.onRequest(store.get([...base, SNAPSHOT_TYPE]), prior => {
                                api.setResult(validateStoredSnapshot(existing, prior));
                            });
                            return;
                        }
                        // Both writes share one transaction: neither record can become
                        // visible alone. The legacy keys are never removed or rewritten.
                        api.onRequest(store.put(snapshotRecord));
                        api.onRequest(store.put(marker));
                        api.setResult({ status: 'SNAPSHOT_CAPTURED', marker });
                    });
                });
                guard.assertActive();
                const verified = await readCapturedSnapshot(context);
                if (!['SNAPSHOT_CAPTURED', 'IMPORTED'].includes(verified.status)) {
                    throw migrationError('AUTOFARM_MIGRATION_INCOMPLETE', 'Committed snapshot could not be read back');
                }
                return { ...outcome, snapshot: verified.snapshot };
            }, { ttlMs: 30000 });
        }

        return {
            readCapturedSnapshot, migrateLegacySnapshot, materializeLegacySnapshot,
            readRecord, readIndex, putRecords, appendDiagnostic, putMetaCas,
            prepareMutation, markMutationTransmitting, settleMutation,
            confirmPendingReport, commitLearnedReport
        };
    }

    root.PremiumFeaturesAutoFarmStorage = Object.freeze({
        create: createAutoFarmStorage,
        readLegacySnapshot
    });
})(window);

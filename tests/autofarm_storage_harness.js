'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptiveStorage.js'), 'utf8');
const world = 'pt99.tribalwars.com.pt';
const prefix = `twaf59:${world}:p7:v1:`;
const stopKey = `twaf59:${world}:p7:accountHardStop`;

function memoryStorage(seed = {}) {
    const values = new Map(Object.entries(seed));
    return {
        values,
        get length() { return values.size; },
        key(index) { return [...values.keys()][index] ?? null; },
        getItem(key) { return values.get(String(key)) ?? null; },
        setItem(key, value) { values.set(String(key), String(value)); },
        removeItem(key) { values.delete(String(key)); }
    };
}

function fakeTransaction() {
    let stores = new Map([
        ['autofarm_meta', new Map()], ['autofarm_farms', new Map()],
        ['autofarm_dispatches', new Map()], ['autofarm_reports', new Map()],
        ['autofarm_events', new Map()], ['autofarm_operational', new Map()],
        ['autofarm_mutations', new Map()],
        ['autofarm_diagnostics', new Map()]
    ]);
    let failPut = false;
    let failPredicate = null;
    let commits = 0;
    let beforeRequests = null;
    async function transact(names, mode, execute) {
        for (const name of names) assert.equal(stores.has(name), true, `declared store ${name}`);
        const pending = [];
        const staged = new Map([...stores].map(([name, rows]) => [name, new Map(rows)]));
        let result;
        const api = {
            store(name) {
                assert.equal(names.includes(name), true, `${name} was declared`);
                return {
                    get(key) { return { kind: 'get', store: name, key: JSON.stringify(key) }; },
                    index(indexName) {
                        return {
                            getAll(key) { return { kind: 'getAll', store: name, indexName, key }; }
                        };
                    },
                    delete(key) { return { kind: 'delete', store: name, key: JSON.stringify(key) }; },
                    put(record) {
                        assert.equal(mode, 'readwrite');
                        const key = name === 'autofarm_meta' || name === 'autofarm_operational'
                            ? [record.world, record.playerId, record.sourceVillageId, record.recordType]
                            : name === 'autofarm_farms'
                                ? [record.world, record.playerId, record.sourceVillageId, record.targetCoord]
                                : name === 'autofarm_reports'
                                    ? [record.world, record.playerId, record.reportId]
                                    : record.dispatchId || record.eventId;
                        return { kind: 'put', store: name, key: JSON.stringify(key), record };
                    }
                };
            },
            onRequest(request, callback) { pending.push({ request, callback }); },
            setResult(value) { result = value; }
        };
        execute(api);
        beforeRequests?.();
        beforeRequests = null;
        while (pending.length) {
            const { request, callback } = pending.shift();
            if (request.kind === 'put') {
                if (failPut || failPredicate?.(request.record)) {
                    throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
                }
                staged.get(request.store).set(request.key, request.record);
                callback?.(request.key);
            } else if (request.kind === 'delete') {
                staged.get(request.store).delete(request.key);
                callback?.();
            } else if (request.kind === 'getAll') {
                const [recordWorld, recordPlayer, recordVillage] = request.key.map(String);
                callback?.([...staged.get(request.store).values()].filter(record =>
                    String(record.world) === recordWorld && String(record.playerId) === recordPlayer &&
                    String(record.sourceVillageId) === recordVillage));
            } else {
                callback?.(staged.get(request.store).get(request.key));
            }
        }
        if (mode === 'readwrite') {
            stores = staged;
            commits++;
        }
        return result;
    }
    return {
        transact,
        get rows() { return stores.get('autofarm_meta'); },
        store(name) { return stores.get(name); },
        get commits() { return commits; },
        setFailPut(value) { failPut = value; },
        setFailPredicate(value) { failPredicate = value; },
        beforeRequests(callback) { beforeRequests = callback; },
        corrupt(marker) {
            stores.get('autofarm_meta').set(JSON.stringify([world, '7', '1', 'legacyMigration']), marker);
        }
    };
}

function fixture(seed = {}) {
    const storage = memoryStorage(seed);
    const context = vm.createContext({
        window: null,
        console,
        Date,
        Object,
        Promise
    });
    context.window = context;
    context.location = { host: world };
    context.game_data = { player: { id: 7 } };
    context.localStorage = storage;
    vm.runInContext(source, context, { filename: 'autoFarmAdaptiveStorage.js' });
    const idb = fakeTransaction();
    let leaseRuns = 0;
    const coordination = {
        async runWithLease(_key, run) {
            leaseRuns++;
            return run({ assertActive() {} });
        }
    };
    const service = context.PremiumFeaturesAutoFarmStorage.create({
        host: context,
        storage,
        coordination,
        transact: idb.transact,
        now: () => 100000
    });
    return {
        service, storage, idb, api: context.PremiumFeaturesAutoFarmStorage,
        get leaseRuns() { return leaseRuns; }
    };
}

async function run() {
    const seed = {
        [`${prefix}settings`]: JSON.stringify({ enabled: false, farmTemplate: 'A' }),
        [`${prefix}adaptiveV2`]: JSON.stringify({ schema: 10, farms: { '501|500': {} }, reportLedger: [] }),
        [`${prefix}lease`]: JSON.stringify({ expiresAt: 90000 }),
        [stopKey]: JSON.stringify({ active: true, reason: 'CAPTCHA' })
    };
    {
        const x = fixture(seed);
        const before = [...x.storage.values];
        const captured = await x.service.migrateLegacySnapshot({ sourceVillageId: '1' });
        assert.equal(captured.status, 'DISCOVERED');
        assert.equal(captured.snapshot.entryCount, 3);
        assert.equal(captured.marker.accountHardStopActive, true);
        assert.deepEqual([...x.storage.values], before, 'legacy localStorage is not modified');
        assert.equal(x.idb.rows.size, 2, 'snapshot and marker are committed together');
        const imported = await x.service.materializeLegacySnapshot({ sourceVillageId: '1' });
        assert.equal(imported.status, 'VERIFIED');
        assert.equal(x.idb.store('autofarm_farms').size, 1);
        const settings = await x.service.readRecord('autofarm_meta', [world, '7', '1', 'settings']);
        assert.equal(settings.value.enabled, false, 'import cannot enable native automation');
        const changed = await x.service.putMetaCas({ sourceVillageId: '1' }, 'settings', 1,
            { ...settings.value, radius: 12 });
        assert.equal(changed.revision, 2);
        assert.equal(changed.writeStatus, 'WRITTEN');
        const unchanged = await x.service.putMetaCas({ sourceVillageId: '1' }, 'settings', 2,
            { ...settings.value, radius: 12 });
        assert.equal(unchanged.writeStatus, 'UNCHANGED', 'idempotent CAS is a successful no-op');
        await assert.rejects(
            x.service.putMetaCas({ sourceVillageId: '1' }, 'settings', 1, { radius: 99 }),
            { code: 'AUTOFARM_CAS_MISMATCH' }
        );
        const repeated = await x.service.migrateLegacySnapshot({ sourceVillageId: '1' });
        assert.equal(repeated.marker.capturedAt, captured.marker.capturedAt, 'second import reuses the committed snapshot');
        assert.equal((await x.service.materializeLegacySnapshot({ sourceVillageId: '1' })).status, 'VERIFIED');
        assert.equal((await x.service.legacyAuthorityStatus({ sourceVillageId: '1' })).status,
            'LEGACY_HANDOFF_REQUIRED', 'verified data is not mutation authority');
        assert.equal((await x.service.confirmLegacyHandoff({ sourceVillageId: '1' })).status,
            'TWPF_AUTHORITY', 'explicit handoff enables native authority');
        assert.equal(x.leaseRuns, 4);
    }
    {
        const x = fixture({ ...seed, [`${prefix}settings`]: JSON.stringify({ enabled: true }) });
        await assert.rejects(x.service.migrateLegacySnapshot({ sourceVillageId: '1' }),
            { code: 'AUTOFARM_LEGACY_ACTIVE' });
        assert.equal(x.idb.rows.size, 0);
    }
    {
        const x = fixture({ ...seed, [`${prefix}lease`]: JSON.stringify({ expiresAt: 100001 }) });
        await assert.rejects(x.service.migrateLegacySnapshot({ sourceVillageId: '1' }),
            { code: 'AUTOFARM_LEGACY_ACTIVE' });
        assert.equal(x.idb.rows.size, 0);
    }
    {
        const x = fixture(seed);
        x.idb.setFailPut(true);
        await assert.rejects(x.service.migrateLegacySnapshot({ sourceVillageId: '1' }), { name: 'QuotaExceededError' });
        assert.equal(x.idb.rows.size, 0, 'quota failure rolls back both writes');
        x.idb.setFailPut(false);
        assert.equal((await x.service.migrateLegacySnapshot({ sourceVillageId: '1' })).status, 'DISCOVERED');
    }
    {
        const x = fixture(seed);
        const inspected = x.api.inspectLegacyAuthority({ sourceVillageId: '1' }, {
            host: { location: { host: world }, game_data: { player: { id: 7 } } },
            storage: x.storage, now: () => 100000
        });
        x.idb.corrupt({
            status: 'DISCOVERED', entryCount: 3, capturedAt: 100000,
            world, playerId: '7', sourceVillageId: '1',
            legacyFingerprint: inspected.legacyFingerprint
        });
        await assert.rejects(x.service.migrateLegacySnapshot({ sourceVillageId: '1' }),
            { code: 'AUTOFARM_MIGRATION_INCOMPLETE' });
    }
    {
        const x = fixture({ [`${prefix}settings`]: '{broken' });
        await assert.rejects(x.service.migrateLegacySnapshot({ sourceVillageId: '1' }),
            { code: 'AUTOFARM_LEGACY_CORRUPT' });
    }
    {
        const x = fixture(seed);
        const scope = { sourceVillageId: '1' };
        await x.service.migrateLegacySnapshot(scope);
        x.idb.setFailPredicate(record => record?.recordType === 'settings');
        await assert.rejects(x.service.materializeLegacySnapshot(scope), { name: 'QuotaExceededError' });
        assert.equal((await x.service.readCapturedSnapshot(scope)).status, 'FAILED',
            'a recoverable materialization failure is explicit and never false-success');
        x.idb.setFailPredicate(null);
        assert.equal((await x.service.materializeLegacySnapshot(scope)).status, 'VERIFIED',
            'FAILED migration can retry through MIGRATING and verify atomically');
    }
    {
        // Tampermonkey-like split: `game_data` is visible as a userscript-global
        // binding but is not mirrored onto the sandbox window/host object.
        const storage = memoryStorage(seed);
        const host = { location: { host: world }, localStorage: storage };
        const context = vm.createContext({
            window: host,
            game_data: { player: { id: 7 } },
            console, Date, Object, Promise
        });
        vm.runInContext(source, context, { filename: 'autoFarmAdaptiveStorage.js' });
        const idb = fakeTransaction();
        const service = host.PremiumFeaturesAutoFarmStorage.create({
            host, storage,
            coordination: { async runWithLease(_key, run) { return run({ assertActive() {} }); } },
            transact: idb.transact,
            now: () => 100000
        });
        const captured = await service.migrateLegacySnapshot({
            world, playerId: '7', sourceVillageId: '1'
        });
        assert.equal(captured.status, 'DISCOVERED',
            'lexical game_data must validate the same account scope when host.game_data is absent');
    }
    {
        const x = fixture(seed);
        await assert.rejects(x.service.migrateLegacySnapshot({ world: 'other.world', sourceVillageId: '1' }),
            { code: 'AUTOFARM_SCOPE_MISMATCH' });
        assert.equal(x.idb.rows.size, 0);
    }
    {
        const x = fixture(seed);
        x.idb.beforeRequests(() => x.storage.setItem(`${prefix}settings`, JSON.stringify({ enabled: true })));
        await assert.rejects(x.service.migrateLegacySnapshot({ sourceVillageId: '1' }),
            { code: 'AUTOFARM_LEGACY_ACTIVE' });
        assert.equal(x.idb.rows.size, 0, 'legacy change before commit cannot publish a migration marker');
    }
    {
        const x = fixture({});
        const scope = { sourceVillageId: '1' };
        const settings = await x.service.putMetaCas(scope, 'settings', 0, { enabled: true });
        const coordination = await x.service.putMetaCas(scope, 'coordination', 0, {
            state: 'WAITING_EXECUTION',
            desiredIntent: { intentId: 'i1', stochasticDecisionId: 's1', desiredExecutionAt: 110000 },
            sources: { CAPACITY: { status: 'READY', data: { value: 2, source: 'ASSISTANT_CURRENT_UNITS' } } },
            executionRound: { dispatchLimitRemaining: 2, status: 'OPEN', pendingMutation: null }
        });
        await x.service.putRecords('autofarm_operational', [{
            world, playerId: '7', sourceVillageId: '1', recordType: 'targetStates',
            revision: 1, value: {}
        }]);
        const guard = { token: 11, assertActive() {} };
        const prepared = await x.service.prepareMutation(scope, {
            mutationId: 'm1', dispatchId: 'm1', executionRoundId: 'r1',
            settingsRevision: settings.revision, coordinationRevision: coordination.revision,
            targetCoord: '501|500', targetId: '99', templateId: '7', farmTemplate: 'A',
            startedAt: 92000
        }, guard);
        assert.equal(prepared.status, 'PREPARED');
        assert.equal(prepared.startedAt, 92000, 'mutation timestamp is captured before POST');
        const targetKey = JSON.stringify([world, '7', '1', 'targetStates']);
        assert.equal(x.idb.store('autofarm_operational').get(targetKey).value['501|500'].sending, true);
        assert.equal((await x.service.markMutationTransmitting(scope, 'm1', guard)).status, 'TRANSMITTING');
        const coordinationKey = JSON.stringify([world, '7', '1', 'coordination']);
        const transmittingCoordination = x.idb.store('autofarm_meta').get(coordinationKey).value;
        assert.equal(transmittingCoordination.state, 'UNKNOWN');
        assert.equal(transmittingCoordination.executionRound.pendingMutation.startedAt, 92000,
            'timeout/reload recovery retains the pre-POST timestamp');
        const settled = await x.service.settleMutation(scope, 'm1', 'CONFIRMED', {}, guard);
        assert.equal(settled.status, 'CONFIRMED');
        assert.equal(x.idb.store('autofarm_dispatches').get(JSON.stringify('m1')).status, 'PENDING');
        assert.equal(x.idb.store('autofarm_operational').get(targetKey).value['501|500'].pending, true);
        const confirmedCoordination = x.idb.store('autofarm_meta').get(coordinationKey).value;
        assert.equal(confirmedCoordination.executionRound.dispatchLimitRemaining, 1);
        assert.equal(confirmedCoordination.sources.CAPACITY.status, 'STALE');
        assert.equal(confirmedCoordination.sources.CAPACITY.invalidated, true,
            'pre-mutation capacity cannot survive a confirmed mutation');
        await x.service.settleMutation(scope, 'm1', 'CONFIRMED', {}, guard);
        assert.equal(x.idb.store('autofarm_meta').get(coordinationKey).value.executionRound.dispatchLimitRemaining, 1,
            'confirmed accounting is exactly once after reload/replay');
    }
    {
        const x = fixture({
            [`${prefix}settings`]: JSON.stringify({ enabled: false }),
            [`${prefix}unknownFutureField`]: JSON.stringify({ preserve: true })
        });
        const scope = { sourceVillageId: '1' };
        await x.service.migrateLegacySnapshot(scope);
        await x.service.materializeLegacySnapshot(scope);
        assert.equal((await x.service.legacyAuthorityStatus(scope)).status, 'LEGACY_HANDOFF_REQUIRED');
        await x.service.confirmLegacyHandoff(scope);
        const cleaned = await x.service.cleanupVerifiedLegacy(scope);
        assert.equal(cleaned.status, 'LEGACY_CLEANED');
        assert.equal(x.storage.getItem(`${prefix}settings`), null, 'only a known verified key is removed');
        assert.notEqual(x.storage.getItem(`${prefix}unknownFutureField`), null, 'unknown legacy data is preserved');
        assert.equal((await x.service.legacyAuthorityStatus(scope)).mutationAllowed, true);
        x.storage.setItem(`${prefix}settings`, JSON.stringify({ enabled: false }));
        const recreated = await x.service.legacyAuthorityStatus(scope);
        assert.equal(recreated.status, 'MIGRATION_BLOCKED', 'recreated known legacy state suspends authority');
        assert.equal(recreated.mutationAllowed, false);
        assert.equal((await x.service.migrateLegacySnapshot(scope)).status, 'DISCOVERED',
            'a changed legacy fingerprint is discovered again');
    }
    {
        const x = fixture({});
        const scope = { sourceVillageId: '1' };
        const settings = await x.service.putMetaCas(scope, 'settings', 0, { enabled: true });
        const coordination = await x.service.putMetaCas(scope, 'coordination', 0, {
            state: 'WAITING_EXECUTION',
            sources: { CAPACITY: { status: 'READY', data: { value: 1, source: 'ASSISTANT_CURRENT_UNITS' } } },
            executionRound: { dispatchLimitRemaining: 4, status: 'OPEN', pendingMutation: null }
        });
        await x.service.putRecords('autofarm_operational', [{
            world, playerId: '7', sourceVillageId: '1', recordType: 'targetStates', revision: 1, value: {}
        }]);
        const guard = { token: 22, assertActive() {} };
        await x.service.prepareMutation(scope, {
            mutationId: 'm-crash', dispatchId: 'm-crash', executionRoundId: 'r-crash',
            settingsRevision: settings.revision, coordinationRevision: coordination.revision,
            targetCoord: '502|500', targetId: '100', templateId: '8', farmTemplate: 'B', startedAt: 93000
        }, guard);
        await x.service.markMutationTransmitting(scope, 'm-crash', guard);
        x.idb.setFailPut(true);
        await assert.rejects(x.service.settleMutation(scope, 'm-crash', 'CONFIRMED', {}, guard),
            { name: 'QuotaExceededError' });
        x.idb.setFailPut(false);
        const journal = x.idb.store('autofarm_mutations').get(JSON.stringify('m-crash'));
        assert.equal(journal.status, 'TRANSMITTING', 'failed post-confirm commit leaves a durable ambiguous journal');
        const state = x.idb.store('autofarm_meta').get(JSON.stringify([world, '7', '1', 'coordination'])).value;
        assert.equal(state.state, 'UNKNOWN');
        assert.equal(state.executionRound.dispatchLimitRemaining, 4, 'failed transaction cannot half-decrement the round');
    }
    {
        const x = fixture({});
        for (let index = 0; index < 25; index++) {
            await x.service.appendDiagnostic({ sourceVillageId: '1' }, {
                eventId: `d${index}`, at: index + 1, value: { index }
            }, 20);
        }
        assert.equal(x.idb.store('autofarm_diagnostics').size, 20, 'diagnostic ledger is bounded');
        assert.equal(x.idb.store('autofarm_diagnostics').has(JSON.stringify('d0')), false, 'oldest diagnostics are pruned');
        assert.equal(x.idb.store('autofarm_diagnostics').has(JSON.stringify('d24')), true, 'newest diagnostic is retained');
    }
    console.log('autofarm_storage_harness: 14 migration/journal/storage cases passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });

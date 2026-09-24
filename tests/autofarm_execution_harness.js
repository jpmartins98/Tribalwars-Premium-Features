'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sources = ['autoFarmAdaptiveCore.js', 'autoFarmAdaptivePlanner.js', 'autoFarmAdaptive.js']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'features', name), 'utf8'));

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function initialRecords(timestamp = Date.now()) {
    const context = { world: 'pt99.tribalwars.com.pt', playerId: '7', sourceVillageId: '1' };
    const settings = {
        enabled: true, farmTemplate: 'A', radius: 10, maxSendsPerPass: 30,
        retrySeconds: 90, attemptGapMs: 0, adaptiveEnabled: true,
        adaptiveMinDispatchEfficiency: 0.45, adaptiveReferenceCapacity: 160,
        adaptiveHistoryDays: 7, pendingTimeoutHours: 12,
        stochasticSchedulingMode: 'IMMEDIATE_EFFICIENCY'
    };
    const proof = {
        value: 1, exact: true, authoritative: true,
        source: 'ASSISTANT_CURRENT_UNITS', observedAt: timestamp - 1000,
        freshUntil: timestamp + 60000, sourceVillageId: '1', templateId: '7', farmTemplate: 'A',
        composition: { spear: 1 }, compositionAuthoritative: true,
        currentUnits: { spear: 1 }, availableAtHome: true,
        authority: 'AM_FARM_FRESH_CURRENT_UNITS', revision: timestamp - 1000
    };
    const candidate = {
        coord: '501|500', targetId: '9', templateId: '7', reportId: null,
        distance: 1, bootstrap: true, reason: 'BOOTSTRAP_NEW'
    };
    const plan = {
        executionRoundId: 'round-1', cycleId: 'round-1:1', generation: 1, planRevision: 1,
        createdAt: timestamp - 2000, notBeforeAt: timestamp - 2000, sourceVillageId: '1',
        radius: 10, farmTemplate: 'A', templateId: '7', candidates: [candidate],
        dispatchLimitRemaining: 30, capacityProof: proof,
        composition: { spear: 1 }, compositionAuthoritative: true,
        sourceRevisions: { settings: 1, map: timestamp - 1000, mapContent: 'map-content-1' },
        requiredSources: ['MAP', 'ASSISTANT', 'TEMPLATE', 'CAPACITY']
    };
    const intent = {
        intentId: 'intent-1', stochasticDecisionId: 'decision-1', executionRoundId: 'round-1',
        generation: 1, mode: 'IMMEDIATE_EFFICIENCY', createdAt: timestamp - 2000,
        stochasticPolicyVersion: 1, stochasticAnchorAt: timestamp - 2000,
        desiredDelayMs: 1000, desiredExecutionAt: timestamp - 1000,
        temporalProfile: 'EARLY', stochasticSubwindowStart: timestamp - 1500,
        stochasticSubwindowEnd: timestamp - 1000, candidateRefs: [candidate],
        candidateSetRevision: 'fixture-revision', randomDrawCount: 6
    };
    const readySource = data => ({
        source: 'ASSISTANT', status: 'READY', observedAt: timestamp - 1000,
        freshUntil: timestamp + 60000, invalidated: false, revision: timestamp - 1000, data
    });
    const coordination = {
        generation: 1, planRevision: 1, state: 'WAITING_EXECUTION',
        executionDueAt: timestamp - 1000, desiredIntent: intent,
        executionRound: {
            executionRoundId: 'round-1', cycleId: 'round-1:1', generation: 1,
            planRevision: 1, sourceVillageId: '1', configuredLimit: 30,
            dispatchLimitRemaining: 30, createdAt: timestamp - 2000, status: 'OPEN', pendingMutation: null
        },
        executionPlan: plan,
        sources: {
            MAP: readySource({
                authorizationFreshUntil: timestamp + 60000,
                analysisFreshUntil: timestamp + 60000,
                targetIds: { '501|500': '9' }, contentRevision: 'map-content-1'
            }),
            ASSISTANT: readySource({ pagesRead: 1, coversRadius: true }),
            TEMPLATE: { ...readySource({ templateId: '7', composition: { spear: 1 }, authoritative: true }), source: 'TEMPLATE' },
            CAPACITY: { ...readySource(proof), source: 'CAPACITY', data: proof }
        }
    };
    return new Map([
        ['settings', { ...context, recordType: 'settings', revision: 1, value: settings }],
        ['coordination', { ...context, recordType: 'coordination', revision: 1, value: coordination }],
        ['targetStates', { ...context, recordType: 'targetStates', revision: 1, value: {} }]
    ]);
}

function storageService(records) {
    const mutations = new Map();
    let confirmedCount = 0;
    return {
        mutations,
        get confirmedCount() { return confirmedCount; },
        async readRecord(_store, key) { return records.get(String(key.at(-1))) || null; },
        async readIndex(store) {
            if (store === 'autofarm_mutations') return [...mutations.values()];
            return [];
        },
        async putMetaCas(scope, type, expectedRevision, value, guard) {
            guard?.assertActive?.();
            const previous = records.get(type);
            if (Number(previous?.revision || 0) !== Number(expectedRevision)) {
                const error = new Error('CAS mismatch'); error.code = 'AUTOFARM_CAS_MISMATCH'; throw error;
            }
            const next = { ...scope, recordType: type, revision: Number(expectedRevision) + 1, value: clone(value) };
            records.set(type, next);
            return clone(next);
        },
        async putRecords(_store, values) {
            for (const value of values) records.set(value.recordType, clone(value));
            return { count: values.length };
        },
        async migrateLegacySnapshot() { return { status: 'NO_LEGACY_DATA' }; },
        async materializeLegacySnapshot() { throw new Error('unexpected migration'); },
        async legacyAuthorityStatus() { return { status: 'NO_LEGACY_AUTHORITY', mutationAllowed: true }; },
        async appendDiagnostic() { return { status: 'WRITTEN' }; },
        async prepareMutation(_scope, input, guard) {
            guard?.assertActive?.();
            const coordination = records.get('coordination');
            assert.equal(input.coordinationRevision, coordination.revision);
            const record = { ...clone(input), status: 'PREPARED', preparedAt: input.startedAt, startedAt: input.startedAt };
            mutations.set(input.mutationId, record);
            return clone(record);
        },
        async markMutationTransmitting(_scope, mutationId, guard) {
            guard?.assertActive?.();
            const record = mutations.get(mutationId);
            record.status = 'TRANSMITTING';
            record.transmittedAt = Date.now();
            const coordination = records.get('coordination');
            const value = clone(coordination.value);
            value.state = 'UNKNOWN';
            value.executionRound.status = 'UNKNOWN';
            value.executionRound.pendingMutation = {
                mutationId, startedAt: record.startedAt, transmissionBoundaryAt: record.transmittedAt
            };
            records.set('coordination', { ...coordination, revision: coordination.revision + 1, value });
            return clone(record);
        },
        async settleMutation(_scope, mutationId, outcome, details, guard) {
            guard?.assertActive?.();
            const record = mutations.get(mutationId);
            if (record.status === 'CONFIRMED' && outcome === 'CONFIRMED') return clone(record);
            record.status = outcome;
            record.details = clone(details);
            const coordination = records.get('coordination');
            const value = clone(coordination.value);
            if (outcome === 'CONFIRMED') {
                confirmedCount++;
                value.executionRound.dispatchLimitRemaining--;
                value.executionRound.status = value.executionRound.dispatchLimitRemaining > 0 ? 'OPEN' : 'EXHAUSTED';
                value.executionRound.pendingMutation = null;
                value.state = 'WAITING_EXECUTION';
                value.desiredIntent = null;
                value.executionDueAt = 0;
                value.sources.CAPACITY = details.capacityProof
                    ? { source: 'CAPACITY', status: 'READY', observedAt: details.capacityProof.observedAt,
                        freshUntil: details.capacityProof.freshUntil, data: clone(details.capacityProof) }
                    : { source: 'CAPACITY', status: 'STALE', invalidated: true, freshUntil: 0, data: null };
            } else if (outcome === 'UNKNOWN') {
                value.state = 'UNKNOWN';
                value.executionRound.status = 'UNKNOWN';
                value.executionRound.pendingMutation = { mutationId, startedAt: record.startedAt };
                value.reconcileDueAt = details.reconcileDueAt;
            }
            records.set('coordination', { ...coordination, revision: coordination.revision + 1, value });
            return clone(record);
        }
    };
}

function controllerFixture(shared, responseFactory) {
    const schedulerState = { hardStopped: false, hardStopReason: null, tasks: [], cancelled: [] };
    let posts = 0;
    let registered;
    let featureVisible = false;
    const context = vm.createContext({
        console, Date, Math, Promise, URL, URLSearchParams, AbortController, Uint32Array,
        window: null, globalThis: null,
        location: { host: 'pt99.tribalwars.com.pt', origin: 'https://pt99.tribalwars.com.pt', href: 'https://pt99.tribalwars.com.pt/game.php' },
        game_data: {
            csrf: 'csrf', link_base_pure: '/game.php?village=1&screen=',
            player: { id: 7 }, village: { id: 1, coord: '500|500' }
        },
        document: { body: null, getElementById() { return null; } },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, get length() { return 0; }, key() { return null; } },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        crypto: { randomUUID: () => 'execution-fixture', getRandomValues(array) { array[0] = 19; return array; } },
        setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
        addEventListener() {},
        fetch: async (_url, options) => {
            if (String(options?.method || 'GET').toUpperCase() === 'POST') posts++;
            return responseFactory();
        },
        PremiumFeaturesSettingsState: { getSetting(name) {
            return name === 'show__auto_farm_adaptive' && featureVisible;
        } },
        PremiumFeaturesAutoFarmStorage: { create() { return shared; } },
        PremiumFeaturesBackgroundScheduler: {
            PRIORITY: { MANUAL: 1, RECONCILIATION: 2, AUTOMATIC: 3 },
            DUE_MODE: { REPLACE: 'REPLACE' },
            registerHandler(_name, handler) { registered = handler; },
            enqueue(task) { schedulerState.tasks.push(task); },
            cancel(key, reason) { schedulerState.cancelled.push({ key, reason }); },
            hasTask() { return false; }, describe() { return null; },
            stats() { return schedulerState; },
            hardStop(reason) { schedulerState.hardStopped = true; schedulerState.hardStopReason ||= reason; }
        },
        PremiumFeaturesCoordination: { instanceId: 'tab-fixture', broadcast() {} }
    });
    context.window = context;
    context.globalThis = context;
    for (let index = 0; index < sources.length; index++) {
        vm.runInContext(sources[index], context, { filename: ['core.js', 'planner.js', 'controller.js'][index] });
    }
    context.PremiumFeaturesAutoFarmAdaptive.init();
    featureVisible = true;
    return {
        context, schedulerState,
        get posts() { return posts; },
        run(kind, guard) {
            return registered([{ world: context.location.host, playerId: '7', sourceVillageId: '1' }, kind], guard);
        }
    };
}

async function run() {
    {
        const records = initialRecords();
        const shared = storageService(records);
        const response = () => ({
            ok: true, status: 200, url: 'https://pt99.tribalwars.com.pt/game.php',
            headers: { get() { return 'application/json'; } },
            async text() { return JSON.stringify({ success: true, current_units: { spear: 0 } }); }
        });
        const tabs = [controllerFixture(shared, response), controllerFixture(shared, response), controllerFixture(shared, response)];
        const guards = [
            { token: 1, assertActive() {} },
            { token: 2, assertActive() { const error = new Error('lease lost'); error.code = 'LEASE_LOST'; throw error; } },
            { token: 3, assertActive() { const error = new Error('lease lost'); error.code = 'LEASE_LOST'; throw error; } }
        ];
        const outcomes = await Promise.allSettled(tabs.map((tab, index) => tab.run('EXECUTION', guards[index])));
        assert.equal(outcomes.filter(item => item.status === 'fulfilled' && item.value.status === 'CONFIRMED').length, 1);
        assert.equal(tabs.reduce((sum, tab) => sum + tab.posts, 0), 1, 'three TWPF tabs perform at most one mutation');
        assert.equal(shared.confirmedCount, 1);
        assert.equal(records.get('coordination').value.executionRound.dispatchLimitRemaining, 29,
            'round accounting decrements exactly once, independently of initial capacity=1');
        assert.equal(records.get('coordination').value.sources.CAPACITY.data.value, 0,
            'POST current_units atomically replaces the pre-mutation proof');
    }
    {
        const records = initialRecords();
        const shared = storageService(records);
        const response403 = () => ({
            ok: false, status: 403, url: 'https://pt99.tribalwars.com.pt/game.php',
            headers: { get() { return 'application/json'; } }, async text() { return '{}'; }
        });
        const tab = controllerFixture(shared, response403);
        const guard = { token: 10, assertActive() {} };
        const first = await tab.run('EXECUTION', guard);
        assert.equal(first.status, 'HARD_STOP');
        assert.equal(first.mutationStatus, 'UNKNOWN', '403 never assumes a mutation result');
        assert.equal(tab.schedulerState.hardStopReason.source, 'http-403');
        assert.equal(tab.posts, 1);
        const second = await tab.run('RECONCILIATION', guard);
        assert.equal(second.status, 'HARD_STOP');
        assert.equal(tab.posts, 1, 'hard-stop performs zero retry/network after the original attempt');
    }
    {
        const records = initialRecords();
        records.get('coordination').value.sources.CAPACITY.data.freshUntil = Date.now() - 1;
        records.get('coordination').value.sources.CAPACITY.freshUntil = Date.now() - 1;
        const shared = storageService(records);
        const tab = controllerFixture(shared, () => { throw new Error('stale final gate must not fetch'); });
        const originalIntent = clone(records.get('coordination').value.desiredIntent);
        const result = await tab.run('EXECUTION', { token: 20, assertActive() {} });
        assert.equal(result.status, 'PROOF_STALE');
        assert.equal(tab.posts, 0, 'final gate is local and a stale proof performs zero POST');
        const state = records.get('coordination').value;
        assert.equal(state.state, 'WAITING_AUTHORIZATION');
        assert.equal(state.desiredIntent.intentId, originalIntent.intentId);
        assert.equal(state.desiredIntent.stochasticDecisionId, originalIntent.stochasticDecisionId);
        assert.equal(state.desiredIntent.desiredExecutionAt, originalIntent.desiredExecutionAt,
            'authorization refresh path preserves desired timing');
    }
    {
        const records = initialRecords();
        const shared = storageService(records);
        shared.prepareMutation = async () => {
            throw Object.assign(new Error('quota before POST'), { name: 'QuotaExceededError' });
        };
        const tab = controllerFixture(shared, () => { throw new Error('critical write failure must prevent POST'); });
        const result = await tab.run('EXECUTION', { token: 30, assertActive() {} });
        assert.equal(result.status, 'FAIL_CLOSED');
        assert.equal(tab.posts, 0);
        assert.equal(records.get('settings').value.enabled, false);
        assert.equal(records.get('coordination').value.state, 'STORAGE_ERROR');
    }
    {
        const records = initialRecords();
        const shared = storageService(records);
        const settle = shared.settleMutation.bind(shared);
        shared.settleMutation = async (...args) => {
            if (args[2] === 'CONFIRMED') {
                throw Object.assign(new Error('commit failed after confirmation'), { name: 'QuotaExceededError' });
            }
            return settle(...args);
        };
        const tab = controllerFixture(shared, () => ({
            ok: true, status: 200, url: 'https://pt99.tribalwars.com.pt/game.php',
            headers: { get() { return 'application/json'; } },
            async text() { return JSON.stringify({ success: true, current_units: { spear: 0 } }); }
        }));
        const result = await tab.run('EXECUTION', { token: 31, assertActive() {} });
        assert.equal(result.status, 'FAIL_CLOSED');
        assert.equal(tab.posts, 1);
        assert.equal([...shared.mutations.values()][0].status, 'TRANSMITTING',
            'post-confirm commit failure retains the journal fence instead of retrying');
        assert.equal(records.get('settings').value.enabled, false);
    }
    console.log('autofarm_execution_harness: 5 multi-tab/hard-stop/final-gate/storage suites passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plannerSource = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptivePlanner.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptive.js'), 'utf8');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function fixture({ mutationStatus = 'UNKNOWN', matching = true, candidate = true } = {}) {
    const startedAt = Date.now() - 30 * 60000;
    const scope = { world: 'pt99.tribalwars.com.pt', playerId: '7', sourceVillageId: '1' };
    const mutation = {
        ...scope, mutationId: 'mutation-1', dispatchId: 'mutation-1', status: mutationStatus,
        targetCoord: '501|500', reportIdAtSend: '100', startedAt,
        transmittedAt: startedAt + 100, composition: { spear: 5, sword: 2 }
    };
    const records = new Map([
        ['settings', { ...scope, recordType: 'settings', revision: 1, value: {
            enabled: true, pendingTimeoutHours: 12, retrySeconds: 90
        } }],
        ['coordination', { ...scope, recordType: 'coordination', revision: 1, value: {
            state: mutationStatus === 'PREPARED' ? 'RECONCILING' : 'UNKNOWN',
            executionRound: {
                executionRoundId: 'round-1', status: mutationStatus === 'PREPARED' ? 'OPEN' : 'UNKNOWN',
                dispatchLimitRemaining: 5,
                pendingMutation: mutationStatus === 'PREPARED' ? null : { mutationId: mutation.mutationId, startedAt }
            },
            reconcileDueAt: Date.now()
        } }],
        ['targetStates', { ...scope, recordType: 'targetStates', revision: 1, value: {} }]
    ]);
    const mutations = new Map([[mutation.mutationId, mutation]]);
    const settles = [];
    const storage = {
        async readRecord(_store, key) { return records.get(String(key.at(-1))) || null; },
        async readIndex(store) { return store === 'autofarm_mutations' ? [...mutations.values()].map(clone) : []; },
        async putMetaCas(inputScope, type, revision, value, guard) {
            guard?.assertActive?.();
            const previous = records.get(type);
            assert.equal(previous.revision, revision);
            const next = { ...inputScope, recordType: type, revision: revision + 1, value: clone(value) };
            records.set(type, next);
            return clone(next);
        },
        async putRecords() { return { count: 0 }; },
        async migrateLegacySnapshot() { return { status: 'NO_LEGACY_DATA' }; },
        async legacyAuthorityStatus() { return { status: 'NO_LEGACY_AUTHORITY', mutationAllowed: true }; },
        async appendDiagnostic() {},
        async settleMutation(_scope, mutationId, outcome, details) {
            const current = mutations.get(mutationId);
            settles.push({ outcome, details: clone(details || {}) });
            current.status = outcome;
            if (outcome === 'CONFIRMED' || outcome === 'NOT_SENT' || outcome === 'REJECTED') {
                const coordination = records.get('coordination');
                const value = clone(coordination.value);
                if (outcome === 'CONFIRMED') value.executionRound.dispatchLimitRemaining--;
                value.executionRound.status = outcome === 'CONFIRMED' ? 'OPEN' : value.executionRound.status;
                value.executionRound.pendingMutation = null;
                value.state = 'WAITING_WORK';
                records.set('coordination', { ...coordination, revision: coordination.revision + 1, value });
            }
            return clone(current);
        }
    };
    let gets = 0;
    let posts = 0;
    let handler;
    const documentFactory = text => {
        if (text === 'INDEX') {
            return {
                entries: candidate ? [{
                    reportId: '101', targetCoord: '501|500', assistantAttackAt: startedAt + 60000
                }] : [],
                querySelector() { return null; }
            };
        }
        return {
            timestamp: startedAt + 60000,
            composition: { spear: 5, sword: 2 },
            querySelector(selector) {
                if (selector === '#attack_info_att') {
                    return { textContent: matching ? 'Source (500|500)' : 'External (499|500)' };
                }
                return null;
            }
        };
    };
    const core = {
        DEFAULTS: {}, PLAN_PROOF_MARGIN_MS: 1000,
        normalizeCfg(value) { return { pendingTimeoutHours: 12, retrySeconds: 90, ...value }; },
        normalizeCoordinationState(value) {
            return {
                state: 'WAITING_WORK', executionDueAt: 0, reportDueAt: 0,
                maintenanceDueAt: 0, reconcileDueAt: 0, capacityDueAt: 0,
                observationDueAt: 0, authorizationDueAt: 0, leaseRecoveryDueAt: 0,
                sources: {}, ...clone(value || {})
            };
        },
        normalizeDesiredIntent(value) { return clone(value || {}); },
        adaptiveReportIdRelation(current, baseline) {
            return BigInt(current) > BigInt(baseline) ? 1 : (BigInt(current) < BigInt(baseline) ? -1 : 0);
        },
        parseReportIndexEntries(doc) { return doc.entries || []; },
        parseReportDetailTimestamp(doc) { return doc.timestamp || null; },
        parseReportComposition(doc) { return doc.composition || null; },
        sameComposition(left, right) { return JSON.stringify(left) === JSON.stringify(right); },
        normalizedCoordList(values) { return [...new Set(values || [])].sort(); }
    };
    let featureVisible = false;
    const context = vm.createContext({
        console, Date, Math, Promise, URL, URLSearchParams, AbortController,
        window: null, globalThis: null,
        location: { host: scope.world, origin: `https://${scope.world}` },
        game_data: { player: { id: 7 }, village: { id: 1, coord: '500|500' } },
        document: { body: null, getElementById() { return null; } },
        DOMParser: class { parseFromString(text) { return documentFactory(text); } },
        setTimeout() { return 1; }, clearTimeout() {},
        fetch: async (url, options) => {
            if (String(options?.method || 'GET').toUpperCase() === 'POST') posts++;
            else gets++;
            const isDetail = /[?&]view=/.test(String(url));
            return {
                ok: true, status: 200, url: String(url), headers: { get() { return 'text/html'; } },
                async text() { return isDetail ? 'DETAIL' : 'INDEX'; }
            };
        },
        PremiumFeaturesAutoFarmAdaptiveCore: core,
        PremiumFeaturesSettingsState: { getSetting() { return featureVisible; } },
        PremiumFeaturesAutoFarmStorage: { create() { return storage; } },
        PremiumFeaturesBackgroundScheduler: {
            PRIORITY: { AUTOMATIC: 3, RECONCILIATION: 2 }, DUE_MODE: { REPLACE: 'REPLACE' },
            registerHandler(_name, callback) { handler = callback; },
            enqueue() {}, cancel() {}, stats() { return { hardStopped: false }; }
        }
    });
    context.window = context;
    context.globalThis = context;
    vm.runInContext(plannerSource, context, { filename: 'planner.js' });
    vm.runInContext(controllerSource, context, { filename: 'controller.js' });
    context.PremiumFeaturesAutoFarmAdaptive.init();
    featureVisible = true;
    return {
        records, mutations, settles,
        get gets() { return gets; }, get posts() { return posts; },
        run() {
            return handler([scope, 'RECONCILIATION'], { token: 1, assertActive() {} });
        }
    };
}

async function run() {
    {
        const x = fixture({ matching: true });
        const result = await x.run();
        assert.equal(result.status, 'RECONCILED');
        assert.equal(x.gets, 2, 'UNKNOWN uses one fresh report index plus at most one detail');
        assert.equal(x.posts, 0);
        assert.equal(x.settles.at(-1).outcome, 'CONFIRMED');
        assert.equal(x.records.get('coordination').value.executionRound.dispatchLimitRemaining, 4);
    }
    {
        const x = fixture({ matching: false });
        const result = await x.run();
        assert.equal(result.status, 'STILL_UNKNOWN');
        assert.equal(x.gets, 2);
        assert.equal(x.posts, 0);
        assert.equal(x.mutations.get('mutation-1').status, 'UNKNOWN',
            'external/manual same-target report never implies SENT or NOT_SENT');
        assert.equal(x.settles.some(item => item.outcome === 'NOT_SENT'), false,
            'UNKNOWN age/no-match never times out to NOT_SENT');
    }
    {
        const x = fixture({ candidate: false });
        const result = await x.run();
        assert.equal(result.status, 'STILL_UNKNOWN');
        assert.equal(x.gets, 1, 'no compatible candidate consumes only the mandatory fresh index read');
        assert.equal(x.posts, 0);
        assert.equal(x.mutations.get('mutation-1').status, 'UNKNOWN');
    }
    {
        const x = fixture({ mutationStatus: 'PREPARED' });
        const result = await x.run();
        assert.equal(result.status, 'ROLLED_BACK_PREPARED');
        assert.equal(x.gets, 0, 'durable PREPARED is positive local evidence that transmission never began');
        assert.equal(x.posts, 0);
        assert.equal(x.settles[0].outcome, 'NOT_SENT');
    }
    console.log('autofarm_reconciliation_harness: 4 UNKNOWN evidence/budget suites passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });

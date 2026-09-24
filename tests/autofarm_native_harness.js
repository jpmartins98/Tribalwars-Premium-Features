'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptive.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptiveCore.js'), 'utf8');
const plannerSource = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptivePlanner.js'), 'utf8');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function fakeDocument() {
    const byId = new Map();
    class Element {
        constructor(tag) {
            this.tagName = String(tag).toUpperCase();
            this.dataset = {};
            this.children = [];
            this.fields = new Map();
            this._innerHTML = '';
        }
        set innerHTML(value) {
            this._innerHTML = String(value);
            if (this._innerHTML.includes('data-role="status"')) {
                this.fields.set('[data-role="status"]', { textContent: 'STARTING · a preparar estado nativo…' });
            }
        }
        get innerHTML() { return this._innerHTML; }
        addEventListener() {}
        remove() { if (this.id) byId.delete(this.id); }
        querySelector(selector) {
            if (!this.fields.has(selector)) this.fields.set(selector, {
                textContent: '', value: '', hidden: false, dataset: {}, classList: { toggle() {} }
            });
            return this.fields.get(selector);
        }
        querySelectorAll() { return []; }
        appendChild(node) { this.children.push(node); if (node.id) byId.set(node.id, node); return node; }
    }
    const body = new Element('body');
    return {
        body, activeElement: null,
        createElement(tag) { return new Element(tag); },
        getElementById(id) { return byId.get(String(id)) || null; }
    };
}

async function tampermonkeyBootFixture() {
    const gate = deferred();
    const records = new Map();
    let firstSettingsRead = true;
    const storageService = {
        async readRecord(_store, key) {
            const type = key.at(-1);
            if (type === 'settings' && firstSettingsRead) {
                firstSettingsRead = false;
                await gate.promise;
            }
            return records.get(type) || null;
        },
        async putMetaCas(scope, type, expectedRevision, value) {
            const previous = records.get(type);
            assert.equal(Number(previous?.revision || 0), Number(expectedRevision));
            const record = { ...scope, recordType: type, revision: Number(expectedRevision) + 1, value };
            records.set(type, record);
            return record;
        },
        async putRecords(_store, values) {
            for (const value of values) records.set(value.recordType, value);
            return { count: values.length };
        },
        async migrateLegacySnapshot() { return { status: 'NO_LEGACY_DATA' }; },
        async materializeLegacySnapshot() { throw new Error('no legacy snapshot'); },
        async legacyAuthorityStatus() { return { status: 'NO_LEGACY_AUTHORITY', mutationAllowed: true }; },
        async readIndex() { return []; },
        async appendDiagnostic() { return { status: 'WRITTEN' }; }
    };
    let registered = null;
    let registerCount = 0;
    const cancelled = [];
    const document = fakeDocument();
    const context = vm.createContext({
        console, Date, Math, Promise, URL, URLSearchParams, AbortController, Uint32Array,
        window: null, globalThis: null, document,
        location: { host: 'pt99.tribalwars.com.pt', origin: 'https://pt99.tribalwars.com.pt', href: 'https://pt99.tribalwars.com.pt/game.php' },
        game_data: { player: { id: 7 }, village: { id: 1, coord: '500|500' } },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, get length() { return 0; }, key() { return null; } },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        crypto: { randomUUID: () => 'boot-fixture', getRandomValues(array) { array[0] = 7; return array; } },
        addEventListener() {}, setInterval() { throw new Error('controller cannot own intervals'); },
        setTimeout() { return 1; }, clearTimeout() {},
        fetch() { throw new Error('boot must remain zero-network'); },
        PremiumFeaturesAutoFarmStorage: { create() { return storageService; } },
        PremiumFeaturesBackgroundScheduler: {
            PRIORITY: { MANUAL: 1, RECONCILIATION: 2, AUTOMATIC: 3 },
            registerHandler(name, handler) { registerCount++; registered = { name, handler }; },
            cancel(key, reason) { cancelled.push({ key, reason }); },
            hasTask() { return false; },
            describe() { return null; },
            stats() { return { hardStopped: false }; }
        }
    });
    context.window = context;
    context.globalThis = context;
    // Tampermonkey-like: the settings object/accessor is lexical, not a page-window property.
    vm.runInContext(`
        const settings_cookies = { general: { show__auto_farm_adaptive: true } };
        function getSetting(name) { return settings_cookies.general[name]; }
    `, context);
    assert.equal(context.settings_cookies, undefined);
    vm.runInContext(coreSource, context, { filename: 'autoFarmAdaptiveCore.js' });
    vm.runInContext(plannerSource, context, { filename: 'autoFarmAdaptivePlanner.js' });
    vm.runInContext(source, context, { filename: 'autoFarmAdaptive.js' });
    const api = context.PremiumFeaturesAutoFarmAdaptive;
    assert.equal(api._test.featureAllowed(), true, 'lexical canonical accessor enables the feature');
    const pending = api.init();
    const duplicatePending = api.init();
    assert.strictEqual(duplicatePending, pending, 'concurrent init calls share one lifecycle Promise');
    const panel = document.getElementById('twpf-autofarm-adaptive');
    assert.ok(panel, 'UI shell exists before async storage/migration completes');
    assert.match(panel.querySelector('[data-role="status"]').textContent, /^STARTING/);
    assert.equal(records.has('settings'), false, 'storage is still waiting while STARTING is visible');
    gate.resolve();
    assert.equal(await pending, true);
    assert.ok(records.has('settings'), 'native settings were created');
    assert.ok(records.has('coordination'), 'native coordination was created');
    assert.equal(records.get('settings').value.enabled, false, 'visibility never silently enables mutations');
    assert.equal(registered.name, 'autofarm-adaptive-v2.0.15');
    assert.equal(registerCount, 1, 'scheduler handler is registered once');
    assert.equal(document.body.children.filter(node => node.id === 'twpf-autofarm-adaptive').length, 1,
        'duplicate init creates one panel');
    assert.equal(cancelled.length, 1, 'disabled native state has no armed mutation task');

    const assistantFixture = currentUnits => ({
        rows: new Map([['501|500', { buttonSupported: true, templateId: '7' }]]),
        firstDoc: {
            querySelectorAll(selector) {
                if (selector === 'script') return [{ textContent:
                    `var templates={"t_7":{"spear":5,"sword":5}};` +
                    `Accountmanager.farm.current_units=${JSON.stringify(currentUnits)};` +
                    'var total_units={"spear":250,"sword":250};var support_units={"spear":250,"sword":250};'
                }];
                return [];
            }
        }
    });
    const negative = api._test.chooseTemplateAndCapacity(
        assistantFixture({ spear: 0, sword: 0 }), { farmTemplate: 'A' }, '1'
    );
    assert.equal(negative.capacity, 0, 'total/support/away counters cannot override zero available-at-home troops');
    assert.equal(negative.proof.availableAtHome, true);
    assert.equal(negative.proof.authority, 'AM_FARM_FRESH_CURRENT_UNITS');
    const positive = api._test.chooseTemplateAndCapacity(
        assistantFixture({ spear: 25, sword: 15 }), { farmTemplate: 'A' }, '1'
    );
    assert.equal(positive.capacity, 3, 'fresh am_farm current_units is the authoritative at-home fixture');
    assert.equal(api._test.uiState({ enabled: false }, { state: 'DISABLED' }, '', null), 'OFF');
    assert.equal(api._test.uiState({ enabled: true }, { state: 'UNKNOWN' }, '', null), 'UNKNOWN');
    assert.equal(api._test.uiState({ enabled: true }, { state: 'WAITING_WORK', reportDueAt: Date.now() }, '', null),
        'WAITING_REPORT');
    assert.equal(api._test.uiState({ enabled: true }, { state: 'WAITING_EXECUTION' },
        'LEGACY_HANDOFF_REQUIRED', null), 'LEGACY_HANDOFF_REQUIRED');
    assert.equal(api._test.uiState({ enabled: true }, { state: 'WAITING_EXECUTION' }, '',
        { state: 'WAITING_LEASE' }), 'WAITING_LEASE');
}

async function run() {
    const executionBody = source.slice(
        source.indexOf('async function executeOccurrence'),
        source.indexOf('function reportIsSafelyNewer')
    );
    assert.equal((executionBody.match(/await sendFarm\s*\(/g) || []).length, 1,
        'an execution occurrence contains exactly one POST call site');
    assert.equal(/\b(?:for|while)\s*\(/.test(executionBody), false,
        'execution occurrence cannot loop over POST candidates');
    assert.ok(executionBody.indexOf('prepareMutation') < executionBody.indexOf('markMutationTransmitting'));
    assert.ok(executionBody.indexOf('markMutationTransmitting') < executionBody.indexOf('await sendFarm'));
    assert.ok(executionBody.indexOf('const mutationAttemptAt') < executionBody.indexOf('prepareMutation'),
        'the mutation timestamp is captured before the journal and POST');
    assert.equal((source.match(/await sendFarm\s*\(/g) || []).length, 1,
        'the entire native controller has one mutation call site');
    assert.match(source, /const REPORT_GET_BUDGET = 6;/, 'REPORT occurrence has a total GET budget');
    let fetches = 0;
    let timers = 0;
    let listeners = 0;
    let registered = null;
    const cancelled = [];
    const context = vm.createContext({
        console,
        Date,
        Math,
        Promise,
        URL,
        URLSearchParams,
        AbortController,
        window: null,
        location: { host: 'pt99.tribalwars.com.pt', origin: 'https://pt99.tribalwars.com.pt' },
        game_data: { player: { id: 7 }, village: { id: 1, coord: '500|500' } },
        settings_cookies: { general: { show__auto_farm_adaptive: false } },
        document: {
            body: null,
            getElementById() { return null; }
        },
        addEventListener() { listeners++; },
        setInterval() { timers++; return 1; },
        setTimeout() { timers++; return 1; },
        clearTimeout() {},
        fetch() { fetches++; throw new Error('network must remain idle'); },
        PremiumFeaturesAutoFarmAdaptiveCore: {
            normalizedCoordList(values) {
                return [...new Set((Array.isArray(values) ? values : [])
                    .map(String)
                    .filter(coord => /^\d{3}\|\d{3}$/.test(coord)))].sort();
            },
            adaptiveReportIdRelation(current, baseline) {
                if (!/^\d+$/.test(String(current)) || !/^\d+$/.test(String(baseline))) return null;
                return BigInt(current) > BigInt(baseline) ? 1 : (BigInt(current) < BigInt(baseline) ? -1 : 0);
            }
        },
        PremiumFeaturesBackgroundScheduler: {
            PRIORITY: { MANUAL: 1, RECONCILIATION: 2, AUTOMATIC: 3 },
            registerHandler(name, handler) { registered = { name, handler }; },
            cancel(key, reason) { cancelled.push({ key, reason }); },
            stats() { return { hardStopped: false }; }
        }
    });
    context.window = context;
    vm.runInContext(source, context, { filename: 'autoFarmAdaptive.js' });
    const api = context.PremiumFeaturesAutoFarmAdaptive;
    assert.ok(api, 'native controller is exported');
    assert.equal(fetches, 0, 'module evaluation performs no network');
    assert.equal(timers, 0, 'module evaluation owns no timer loop');
    assert.equal(listeners, 0, 'module evaluation installs no global listeners');

    assert.equal(await api.init(), false, 'globally hidden feature remains inert');
    assert.equal(registered.name, 'autofarm-adaptive-v2.0.15', 'persistent scheduler handler is registered');
    assert.equal(fetches, 0);
    assert.equal(timers, 0);

    const disabled = await api.runOccurrence({
        world: context.location.host, playerId: '7', sourceVillageId: '1'
    }, 'EXECUTION', { assertActive() {} });
    assert.equal(disabled.status, 'FEATURE_DISABLED');
    assert.equal(cancelled.length, 1);
    assert.equal(fetches, 0, 'disabled persisted wake cannot reach fetch');

    assert.equal(api.reportIsSafelyNewer({ reportId: '101', assistantAttackAt: 100000 }, {
        reportIdAtSend: '100', transmittedAt: 99000
    }), true);
    assert.equal(api.reportIsSafelyNewer({ reportId: '100', assistantAttackAt: 100000 }, {
        reportIdAtSend: '100', transmittedAt: 99000
    }), false, 'baseline report cannot confirm a mutation');
    assert.equal(api.reportIsSafelyNewer({ reportId: '101', assistantAttackAt: 70000 }, {
        reportIdAtSend: '100', transmittedAt: 200000
    }), false, 'temporally earlier report cannot confirm a mutation');
    assert.equal(api._test.historicalEvidence('501|500', {
        farms: {}, dispatches: [], reportLedger: [], events: [],
        reportIndex: { historyCoords: ['501|500'] }
    }, {}), true, 'global report-index evidence permanently blocks false BOOTSTRAP_NEW');

    const map = api.parseWorldMap('9,Barb,501,500,0,0\n10,Owned,502,500,7,0\n11,Far,530,500,0,0', 5);
    assert.equal(JSON.stringify([...map.entries()]), JSON.stringify([['501|500', '9']]),
        'only owner=0 targets inside radius are admitted');
    await tampermonkeyBootFixture();
    console.log('autofarm_native_harness: 2 lifecycle/boot/safety suites passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const tests = [];

function test(name, run) { tests.push({ name, run }); }

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]));
    return {
        get length() { return values.size; },
        key(index) { return Array.from(values.keys())[index] ?? null; },
        getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
        setItem(key, value) { values.set(String(key), String(value)); this[String(key)] = String(value); },
        removeItem(key) { values.delete(String(key)); delete this[String(key)]; },
        clear() { Array.from(values.keys()).forEach(key => this.removeItem(key)); },
        dump() { return Object.fromEntries(values); }
    };
}

function createDocument() {
    return {
        hidden: false,
        body: {},
        documentElement: {},
        location: { href: 'https://en1.tribalwars.net/game.php?village=1&screen=overview' },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById() { return null; },
        createElement() { return { style: {}, append() {}, appendChild() {}, querySelector() { return null; } }; },
        addEventListener() {},
        removeEventListener() {}
    };
}

function createContext(overrides = {}) {
    const localStorage = overrides.localStorage || createStorage();
    const document = overrides.document || createDocument();
    const context = {
        console: { log() {}, warn() {}, error() {} },
        Date,
        Math,
        JSON,
        Map,
        Set,
        WeakMap,
        Promise,
        URL,
        URLSearchParams,
        TextEncoder,
        localStorage,
        document,
        location: {
            href: document.location.href,
            hostname: 'en1.tribalwars.net',
            host: 'en1.tribalwars.net',
            origin: 'https://en1.tribalwars.net',
            reload() {}
        },
        navigator: {},
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        addEventListener() {},
        removeEventListener() {},
        game_data: {
            world: 'en1', csrf: 'csrf', link_base_pure: '/game.php?village=1&screen=',
            village: { id: 1 }, player: { id: 7, points: 1000 }, features: { Premium: { active: true } }
        },
        settings_cookies: { general: {}, widgets: [] },
        Timing: { getCurrentServerTime: () => Date.now() },
        serverTimezoneOffsetMs: 0,
        twWallClockToEpochMs: () => Date.now() + 86400000,
        t: key => key,
        showAutoHideBox() {},
        fetch: async () => ({ ok: true, status: 200, url: 'https://en1.tribalwars.net/game.php', text: async () => '', json: async () => ({}) }),
        DOMParser: class { parseFromString() { return createDocument(); } },
        ...overrides
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    return context;
}

function load(context, relativePath) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), context, { filename: relativePath });
}

function installTimerHarness(context) {
    const timers = new Map();
    context.setHandlerOnTimeOut = function (id, handlerName, args, waitMs) {
        const descriptor = { id, handlerName, args: Array.from(args || []), waitMs: Number(waitMs) || 0, dueAt: Date.now() + (Number(waitMs) || 0) };
        timers.set(String(id), descriptor);
        context.localStorage.setItem('endTime_' + id, String(descriptor.dueAt));
        context.localStorage.setItem('handler_' + id, JSON.stringify({ handlerName, args }));
        return descriptor;
    };
    context.clearPersistedTimeout = function (id) {
        timers.delete(String(id));
        context.localStorage.removeItem('endTime_' + id);
        context.localStorage.removeItem('handler_' + id);
    };
    context.registerTimeoutHandler = function () {};
    return timers;
}

test('diagnostics is bounded and counts local outcomes without network', () => {
    const context = createContext();
    load(context, 'utils/core_diagnostics.js');
    const diagnostics = context.createLocalDiagnostics({ capacity: 20, tabId: 'A' });
    for (let index = 0; index < 25; index++) diagnostics.record({ status: index % 2 ? 'CACHE_HIT' : 'SKIPPED' });
    assert.equal(diagnostics.getEntries().length, 20);
    assert.equal(diagnostics.getCounters().CACHE_HIT, 12);
    assert.equal(diagnostics.getCounters().SKIPPED, 13);
});

test('paladin reload rearms known finish five times with zero network and one logical timer', () => {
    let fetches = 0;
    const context = createContext({
        settings_cookies: { general: { show__auto_paladin_train: { enabled: true, maxLevel: 30 } } },
        PremiumFeaturesPrivateAutomations: true,
        fetch: async () => { fetches++; throw new Error('unexpected network'); }
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/trainerPaladin.js');
    context._writePaladinState({ state: 'TRAINING', trainingEndsAt: Date.now() + 600000, reason: 'test' });
    for (let index = 0; index < 5; index++) context.checkAndSchedulePaladinTrainer();
    assert.equal(fetches, 0);
    assert.equal(timers.size, 1);
    assert.ok(timers.get('auto_trainer_paladin').waitMs > 500000);
});

test('Paladin known at configured max creates zero timers and zero requests', () => {
    let requests = 0;
    const context = createContext({
        settings_cookies: { general: { show__auto_paladin_train: { enabled: true, maxLevel: 30 } } },
        PremiumFeaturesPrivateAutomations: true,
        fetch: async () => { requests++; throw new Error('unexpected network'); }
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/trainerPaladin.js');
    context._writePaladinState({ state: 'COMPLETE', trainingEndsAt: null, level: 30 });
    for (let index = 0; index < 5; index++) context.checkAndSchedulePaladinTrainer();
    assert.equal(requests, 0);
    assert.equal(timers.size, 0);
});

test('paladin finish observation starts the original cheapest regimen once', async () => {
    const context = createContext({
        settings_cookies: { general: { show__auto_paladin_train: { enabled: true, maxLevel: 30 } } },
        PremiumFeaturesPrivateAutomations: true
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/trainerPaladin.js');
    vm.runInContext(`
        _fetchPaladinState = async function () {
            return { id: 9, level: 4, current_regimen: null, activity: {}, usable_regimens: [{ id: 3, duration: 90 }] };
        };
        var paladinStarts = 0;
        _startPaladinTraining = async function (knightId, regimenId) {
            paladinStarts++;
            return { status: 'TRAINING', knightId: knightId, regimenId: regimenId };
        };
    `, context);
    const state = context._writePaladinState({ state: 'IDLE', trainingEndsAt: null, knightId: '9', regimenId: null });
    const result = await context.runPaladinTrainerWorker(state.generation, context._paladinSnapshot(state), 'known-training-finish');
    assert.equal(result.status, 'TRAINING');
    assert.equal(context.paladinStarts, 1);
    assert.equal(timers.size, 0);
});

test('paladin POST network loss becomes UNCERTAIN and queues reconciliation', async () => {
    const queued = [];
    const context = createContext({
        settings_cookies: { general: { show__auto_paladin_train: { enabled: true, maxLevel: 30 } } },
        PremiumFeaturesPrivateAutomations: true,
        PremiumFeaturesBackgroundScheduler: { PRIORITY: { RECONCILIATION: 2 }, enqueue(task) { queued.push(task); } }
    });
    installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/trainerPaladin.js');
    vm.runInContext(`fetch = async function () { throw new TypeError('network'); }; window.fetch = fetch;`, context);
    const expected = context._writePaladinState({ state: 'IDLE', knightId: '9', regimenId: null, trainingEndsAt: null });
    const result = await context._startPaladinTraining('9', '3', 90, expected);
    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(context._readPaladinState().state, 'UNCERTAIN');
    assert.equal(queued.length, 1);
});

function createBuildInstantSystem(buttonFactory) {
    const now = Date.now();
    const record = {
        official: {
            generation: 1, queue: ['main'], levels: [2], slots: [now + 60000],
            cancelIds: ['44'], nextSlotAt: now + 60000, instantFree: null, fetchedAt: now
        },
        instant: { state: 'IDLE' }
    };
    const context = createContext({
        settings_cookies: { general: { show__auto_build_instant_free: true } },
        bqGet: () => record.official.nextSlotAt,
        PremiumFeaturesBuildState: {
            get() { return record; },
            setInstant(_villageId, patch) { record.instant = Object.assign({}, record.instant, patch); return record; },
            updateOfficial(_villageId, supplied) { record.official = Object.assign({}, supplied, { generation: record.official.generation + 1 }); return record; },
            publishObservation() {}
        },
        getVillageLinkBase: id => '/game.php?village=' + id + '&screen=',
        getAllVillageIds: () => ['1'],
        bqSet() {}
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/buildInstantFree.js');
    let inspections = 0;
    context.__setInspection = function () {
        vm.runInContext(`
            _inspectBuildInstant = async function () {
                inspections++;
                var nextOfficial = Object.assign({}, window.PremiumFeaturesBuildState.get('1').official, {
                    generation: window.PremiumFeaturesBuildState.get('1').official.generation + 1,
                    instantFree: buttonFactory()
                });
                window.PremiumFeaturesBuildState.get('1').official = nextOfficial;
                return { official: nextOfficial, doc: { querySelector: function () { return null; } } };
            };
        `, context);
    };
    context.buttonFactory = buttonFactory;
    context.inspections = 0;
    context.__setInspection();
    return { context, record, timers };
}

test('Build Instant button absent marks one snapshot STALE and never refetches it immediately', async () => {
    const { context, record, timers } = createBuildInstantSystem(() => null);
    context.checkAndScheduleBuildInstantFree('1', { observeDom: false });
    const first = timers.get('build_instant_free_1');
    await context.runBuildInstantFreeWorker(...first.args);
    assert.equal(record.instant.state, 'STALE');
    assert.equal(context.inspections, 1);
    for (let index = 0; index < 5; index++) context.checkAndScheduleBuildInstantFree('1', { observeDom: false });
    assert.equal(context.inspections, 1);
    assert.equal(timers.size, 1);
    assert.ok(timers.get('build_instant_free_1').dueAt >= record.official.nextSlotAt);
});

test('Build Instant button present reaches exactly one mutation with the observed generation', async () => {
    const { context, timers } = createBuildInstantSystem(() => ({
        orderId: '44', availableFrom: Date.now() - 1000, availableTo: Date.now() + 30000
    }));
    vm.runInContext(`
        var instantMutations = 0;
        buildInstantFreeApiCall = async function () { instantMutations++; return { status: 'SUCCESS' }; };
    `, context);
    context.checkAndScheduleBuildInstantFree('1', { observeDom: false });
    await context.runBuildInstantFreeWorker(...timers.get('build_instant_free_1').args);
    assert.equal(context.instantMutations, 1);
    assert.equal(context.inspections, 1);
});

test('Build Instant old generation and lost lease abort before inspection', async () => {
    const { context, record, timers } = createBuildInstantSystem(() => null);
    context.checkAndScheduleBuildInstantFree('1', { observeDom: false });
    const captured = timers.get('build_instant_free_1').args;
    record.official.generation++;
    await context.runBuildInstantFreeWorker(...captured);
    assert.equal(context.inspections, 0);
    context.PremiumFeaturesCoordination = {
        tabId: 'B', instanceId: 'B1',
        readLease: () => ({ owner: 'A', instanceId: 'A1', expiresAt: Date.now() + 10000 })
    };
    await context.runBuildInstantFreeWorker(...captured);
    assert.equal(context.inspections, 0);
});

test('Build Instant reload preserves UNCERTAIN order and waits for reconciliation due time', () => {
    const { context, record, timers } = createBuildInstantSystem(() => null);
    const retryAt = Date.now() + 60000;
    record.instant = {
        state: 'UNCERTAIN', nextDueAt: retryAt, orderId: '44',
        uncertain: { orderId: '44', at: Date.now() }
    };
    const result = context.checkAndScheduleBuildInstantFree('1', { observeDom: false });
    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(timers.get('build_instant_free_1').args[4], '44');
    assert.ok(timers.get('build_instant_free_1').waitMs > 50000);
    assert.equal(context.inspections, 0);
});

test('three actual village-main consumers share one GET and one BuildState observation', async () => {
    let requests = 0;
    let observations = 0;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const context = createContext({
        getVillageLinkBase: villageId => '/game.php?village=' + villageId + '&screen=',
        observeBuildQueueDocument: (doc, villageId) => {
            observations++;
            return { doc, villageId, official: { generation: 1 } };
        }
    });
    load(context, 'utils/core_async.js');
    context.fetchWithRetry429 = () => { requests++; return pending; };
    const source = fs.readFileSync(path.join(ROOT, 'widgets/extraBuildQueue.js'), 'utf8');
    const fetchFunction = source.match(/function fetchVillageMainPage\(villageId\) \{[\s\S]*?\n\}/);
    assert.ok(fetchFunction);
    vm.runInContext(fetchFunction[0], context);
    const read = () => context.fetchVillageMainPage('77');
    const reads = [read(), read(), read()];
    release('<html></html>');
    const results = await Promise.all(reads);
    assert.equal(results.length, 3);
    assert.equal(requests, 1);
    assert.equal(observations, 1);
});

test('Reports normal navigation inside TTL performs zero forced sync requests', async () => {
    let requests = 0;
    const storage = createStorage({ reports_last_fetch: String(Date.now()) });
    const context = createContext({
        localStorage: storage,
        reportGetAll: async () => [], reportSet: async () => {}, reportRemove: async () => {},
        reportRemoveByIds: async () => [],
        fetch: async () => { requests++; throw new Error('unexpected request'); },
        TWMap: undefined
    });
    load(context, 'utils/reportsManager.js');
    const result = await context.TWPFMapReports.sync();
    assert.equal(result.changed, false);
    assert.equal(requests, 0);
});

test('Report detail consumers coalesce by reportId and reuse immutable parsed data', async () => {
    let requests = 0;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const context = createContext({
        reportGetAll: async () => [], reportSet: async () => {}, reportRemove: async () => {},
        reportRemoveByIds: async () => [], TWMap: undefined
    });
    load(context, 'utils/reportsManager.js');
    context.fetchWithRetry429 = () => { requests++; return pending; };
    const report = { id: '55', coords: '500|500', date: 'today' };
    const consumers = [
        context.TWPFMapReports.hydrateFullReport(report),
        context.TWPFMapReports.hydrateFullReport(report),
        context.TWPFMapReports.hydrateFullReport(report)
    ];
    release('<html></html>');
    const results = await Promise.all(consumers);
    assert.ok(results.every(value => value === report));
    assert.equal(requests, 1);
    assert.equal(await context.TWPFMapReports.hydrateFullReport(report), report);
    assert.equal(requests, 1);
});

test('Outgoing reload inside persisted TTL performs zero requests', async () => {
    let requests = 0;
    const storage = createStorage({ outgoing_commands_fetched_at: String(Date.now()) });
    const context = createContext({
        localStorage: storage,
        settings_cookies: { general: { show__outgoingInfo_map: false } },
        isMapHoverInfoEnabled: () => true,
        fetch: async () => { requests++; throw new Error('unexpected request'); },
        TWMap: undefined
    });
    load(context, 'utils/core_async.js');
    load(context, 'features/map/map.js');
    await context.getOutgoingCommandsFromOverview();
    assert.equal(requests, 0);
});

test('Morale repeated target is single-flight then cache-hit', async () => {
    let requests = 0;
    const context = createContext({
        settings_cookies: { general: {} },
        TWMap: undefined,
        fetch: async () => {
            requests++;
            await Promise.resolve();
            return { ok: true, status: 200, url: 'https://en1.tribalwars.net/game.php', json: async () => ({ morale: 88 }) };
        }
    });
    load(context, 'utils/core_async.js');
    load(context, 'features/map/map.js');
    const values = await Promise.all([
        context.getMoraleForOwner('12', 'defender', 500),
        context.getMoraleForOwner('12', 'defender', 500),
        context.getMoraleForOwner('12', 'defender', 500)
    ]);
    assert.deepEqual(values, [88, 88, 88]);
    assert.equal(requests, 1);
    assert.equal(await context.getMoraleForOwner('12', 'defender', 500), 88);
    assert.equal(requests, 1);
});

test('Morale coalesced transient failure counts once and pauses following hovers', async () => {
    let requests = 0;
    const storage = createStorage();
    const context = createContext({
        localStorage: storage,
        settings_cookies: { general: {} },
        TWMap: undefined,
        fetch: async () => {
            requests++;
            throw Object.assign(new Error('network'), {
                status: 0,
                url: 'https://en1.tribalwars.net/game.php?village=1&screen=place'
            });
        }
    });
    load(context, 'utils/core_async.js');
    load(context, 'features/map/map.js');
    const results = await Promise.allSettled([
        context.getMoraleForOwner('12', 'defender', 500),
        context.getMoraleForOwner('12', 'defender', 500),
        context.getMoraleForOwner('12', 'defender', 500)
    ]);
    assert.ok(results.every(result => result.status === 'rejected'));
    assert.equal(requests, 1);
    const cachedEntries = new Map(JSON.parse(storage.getItem('twpf_morale_cache_v1')));
    assert.equal(cachedEntries.get('12').failureCount, 1);
    assert.ok(cachedEntries.get('12').failedUntil > Date.now());
    assert.equal(await context.getMoraleForOwner('12', 'defender', 500), null);
    assert.equal(requests, 1);
});

test('Scavenging uses distinct village task keys and exact known return scheduling', () => {
    const context = createContext({ PremiumFeaturesPrivateAutomations: true });
    const timers = installTimerHarness(context);
    load(context, 'bots/scavenging.js');
    context._scheduleScavengingAuto(120000, '11');
    context._scheduleScavengingAuto(240000, '22');
    assert.deepEqual(Array.from(timers.keys()).sort(), ['scavenging-auto:11', 'scavenging-auto:22']);
    assert.deepEqual(timers.get('scavenging-auto:11').args, ['11']);
    assert.equal(context._scavSpreadDelayMs(), 0);
    context.saveScavengeConfig({
        enabled: true,
        resilience: { failureCount: 1, retryAt: Date.now() + 60000 }
    }, '11');
    context._scheduleScavengingAuto(0, '11');
    assert.ok(timers.get('scavenging-auto:11').waitMs > 50000);
});

test('Scavenging manual network loss persists UNCERTAIN and schedules one read reconciliation', async () => {
    const context = createContext({
        PremiumFeaturesPrivateAutomations: true,
        fetch: async () => {
            throw Object.assign(new Error('network'), {
                status: 0,
                url: 'https://en1.tribalwars.net/game.php?village=1&screen=scavenge_api'
            });
        }
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/scavenging.js');
    context.saveScavengeConfig({ enabled: false, level: 1, allUnits: false, units: { spear: 10 } }, '1');
    const result = await context.sendScavengeSquadApi({ spear: 10 }, 1, 250, '1');
    assert.equal(result.uncertain, true);
    assert.equal(context.getScavengeConfig('1').uncertain.optionId, 1);
    assert.equal(context.getScavengeConfig('1').enabled, false);
    assert.equal(timers.size, 1);
    assert.equal(timers.get('scavenging-auto:1').handlerName, 'scavengingAutoCheck');
});

test('Scavenging config changed in another tab aborts before mutation network', async () => {
    let requests = 0;
    const context = createContext({
        PremiumFeaturesPrivateAutomations: true,
        fetch: async () => { requests++; throw new Error('must not run'); }
    });
    installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/scavenging.js');
    const original = { enabled: true, level: 1, allUnits: false, units: { spear: 10 }, optionId: 1 };
    context.saveScavengeConfig(original, '1');
    const snapshot = context._scavengingDecisionHash(original);
    context.saveScavengeConfig({ ...original, units: { spear: 20 } }, '1');
    const result = await context.sendScavengeSquadApi({ spear: 10 }, 1, 250, '1', snapshot);
    assert.equal(result.stale, true);
    assert.equal(requests, 0);
    assert.equal(context.getScavengeConfig('1').uncertain, undefined);
});

test('Scavenging manual mutation uses manual priority and the village lease', async () => {
    let scheduledTask = null;
    let requests = 0;
    const scheduler = {
        PRIORITY: { MANUAL: 1 },
        async enqueue(task) {
            scheduledTask = task;
            return { status: 'COMPLETED', value: await task.run({ assertActive() {} }) };
        }
    };
    const context = createContext({
        PremiumFeaturesPrivateAutomations: true,
        PremiumFeaturesBackgroundScheduler: scheduler,
        fetch: async () => {
            requests++;
            return {
                ok: true, status: 200, url: 'https://en1.tribalwars.net/game.php',
                json: async () => ({ response: { squad_responses: [{ success: true }], villages: {} } })
            };
        }
    });
    installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/scavenging.js');
    const config = { enabled: false, level: 1, allUnits: false, units: { spear: 10 }, optionId: 1 };
    context.saveScavengeConfig(config, '1');
    const result = await context.sendScavengeSquadApi(
        { spear: 10 }, 1, 250, '1', context._scavengingDecisionHash(config)
    );
    assert.equal(result.success, true);
    assert.equal(requests, 1);
    assert.equal(scheduledTask.priority, 1);
    assert.equal(scheduledTask.leaseKey, 'scavenging:1');
});

test('Daily repeated start for a completed server day uses one timer and zero requests', () => {
    let requests = 0;
    const context = createContext({
        settings_cookies: { general: { show__auto_daily_bonus: true } },
        fetch: async () => { requests++; throw new Error('unexpected request'); }
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/dailyBonus.js');
    context._dailyWriteState({ serverDay: context._dailyServerDay(), status: 'DONE', attempted: true, collected: true });
    for (let index = 0; index < 5; index++) context.checkAndScheduleDailyBonus();
    assert.equal(requests, 0);
    assert.equal(timers.size, 1);
    assert.equal(timers.get('daily_bonus').handlerName, 'dailyBonusWorker');
});

test('task leases fence three tabs and fail over for Paladin/BuildInstant/Daily/Scavenging/Keep Awake', () => {
    const shared = createStorage();
    let now = 1000;
    const base = createContext({ localStorage: shared });
    load(base, 'utils/core_coordination.js');
    const options = { host: base, storage: shared, now: () => now, clock: base, scope: 'automation-tests' };
    const tabs = ['A', 'B', 'C'].map(id => base.createTabCoordinator({ ...options, tabId: id, instanceId: id + '1' }));
    for (const taskKey of ['paladin', 'build-instant:11', 'daily-bonus', 'scavenging:11', 'keep-awake']) {
        const owner = tabs[0].acquireLease(taskKey, 3000);
        assert.ok(owner);
        assert.equal(tabs[1].acquireLease(taskKey, 3000), null);
        assert.equal(tabs[2].acquireLease(taskKey, 3000), null);
        now = owner.expiresAt + 1;
        const successor = tabs[1].acquireLease(taskKey, 3000);
        assert.ok(successor);
        assert.ok(successor.token > owner.token);
        assert.equal(tabs[0].validateLease(owner), false);
        now = successor.expiresAt + 1;
    }
});

test('Keep Awake repeated setup has one persistent worker; secondary tab cannot reload', async () => {
    let reloads = 0;
    const context = createContext({
        settings_cookies: { general: { keep_awake: true, redirect__train_buildings: false } },
        TribalWars: { getIdleTime: () => 0 },
        location: {
            href: 'https://en1.tribalwars.net/game.php?village=1&screen=overview',
            hostname: 'en1.tribalwars.net', host: 'en1.tribalwars.net', origin: 'https://en1.tribalwars.net',
            reload() { reloads++; }
        }
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_utils.js');
    for (let index = 0; index < 5; index++) context.scheduleKeepAwakeCheck(8);
    assert.equal(timers.size, 1);
    context.PremiumFeaturesCoordination = {
        tabId: 'B', instanceId: 'B1',
        readLease: () => ({ owner: 'A', instanceId: 'A1', expiresAt: Date.now() + 10000 })
    };
    context.TribalWars.getIdleTime = () => 999999;
    assert.equal((await context.runKeepAwakeCheck(8)).status, 'LEASE_LOST');
    assert.equal(reloads, 0);
    const source = fs.readFileSync(path.join(ROOT, 'utils/core_utils.js'), 'utf8');
    assert.doesNotMatch(source, /setInterval\('keep-awake:check'/);
});

(async () => {
    let failed = 0;
    for (let index = 0; index < tests.length; index++) {
        const item = tests[index];
        try {
            await item.run();
            console.log('ok ' + (index + 1) + ' - ' + item.name);
        } catch (error) {
            failed++;
            console.error('not ok ' + (index + 1) + ' - ' + item.name);
            console.error(error);
        }
    }
    if (failed) process.exitCode = 1;
    else console.log('\n' + tests.length + ' automation tests passed');
})();

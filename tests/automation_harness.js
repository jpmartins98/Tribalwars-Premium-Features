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

function createUiDocument() {
    const elements = [];
    function makeElement(tagName = 'div') {
        const listeners = new Map();
        const element = {
            tagName: String(tagName).toUpperCase(), style: {}, dataset: {}, children: [], childNodes: [],
            className: '', id: '', name: '', type: '', value: '', checked: false, disabled: false, textContent: '',
            classList: { add() {}, remove() {}, contains() { return false; } },
            append(...nodes) { nodes.forEach(node => this.appendChild(node)); },
            appendChild(node) { this.children.push(node); node.parentElement = this; return node; },
            insertBefore(node) { this.children.unshift(node); node.parentElement = this; return node; },
            addEventListener(type, listener) { listeners.set(type, listener); },
            removeEventListener() {},
            dispatch(type) { listeners.get(type)?.({ target: this }); },
            setAttribute(name, value) { this[name] = String(value); },
            getAttribute(name) { return this[name] ?? null; },
            removeAttribute(name) { delete this[name]; },
            closest() { return null; }, matches() { return false; }, querySelector() { return null; }, querySelectorAll() { return []; },
            insertRow() { return this.appendChild(makeElement('tr')); },
            insertCell() { return this.appendChild(makeElement('td')); }
        };
        elements.push(element);
        return element;
    }
    const body = makeElement('body');
    const document = {
        hidden: false, body, documentElement: body,
        location: { href: 'https://en1.tribalwars.net/game.php?village=1&screen=place&mode=scavenge' },
        createElement: makeElement,
        createTextNode(text) { return { textContent: String(text) }; },
        getElementById(id) { return elements.find(element => element.id === id) || null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {}
    };
    return { document, elements, makeElement };
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

test('Paladin accepted response parse failure stays UNCERTAIN and does not repeat mutation', async () => {
    let requests = 0;
    const queued = [];
    const context = createContext({
        settings_cookies: { general: { show__auto_paladin_train: { enabled: true, maxLevel: 30 } } },
        PremiumFeaturesBackgroundScheduler: {
            PRIORITY: { RECONCILIATION: 2 }, DUE_MODE: { EARLIEST: 'EARLIEST' },
            enqueue(task) { queued.push(task); }
        },
        fetch: async () => {
            requests++;
            return {
                ok: true, status: 200, url: 'https://en1.tribalwars.net/game.php',
                json: async () => { throw new SyntaxError('truncated mutation response'); }
            };
        }
    });
    installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/trainerPaladin.js');
    const state = context._writePaladinState({ state: 'IDLE', knightId: '9', regimenId: null, trainingEndsAt: null });
    const result = await context._startPaladinTraining('9', '3', 90, state);
    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(context._readPaladinState().state, 'UNCERTAIN');
    assert.equal(requests, 1);
    assert.equal(queued.length, 1);
});

test('Paladin UI is visible without a private gate and invalid maxLevel falls back safely', () => {
    const ui = createUiDocument();
    const context = createContext({
        document: ui.document,
        PremiumFeaturesPrivateAutomations: false,
        settings_cookies: { general: { show__auto_paladin_train: { enabled: false, maxLevel: 0 } }, widgets: [] }
    });
    load(context, 'utils/core_settings.js');
    context.createTabContent('settings.groupAutomation', 0);
    const toggle = ui.elements.find(element => element.name === 'show__auto_paladin_train');
    const maxLevel = ui.elements.find(element => element.name === 'show__auto_paladin_train__maxLevel');
    assert.ok(toggle, 'Auto Paladin toggle was not rendered');
    assert.ok(maxLevel, 'Paladin maximum-level control was not rendered');
    assert.equal(toggle.checked, false);
    installTimerHarness(context);
    load(context, 'bots/trainerPaladin.js');
    assert.equal(context._paladinMaxLevel(), 30);
    context.settings_cookies.general.show__auto_paladin_train = { enabled: true, maxLevel: 30 };
    assert.equal(context._paladinEnabled(), true);
});

test('Paladin confirmed read failure and worker exception both retain a future recovery wake', async () => {
    const context = createContext({
        settings_cookies: { general: { show__auto_paladin_train: { enabled: true, maxLevel: 30 } } }
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/trainerPaladin.js');
    context.PremiumFeaturesAsync.runResilientTask = async () => ({ status: 'FAILED' });
    const initial = context._writePaladinState({ state: 'IDLE', knightId: '9', trainingEndsAt: null });
    const failure = await context.runPaladinTrainerWorker(initial.generation, context._paladinSnapshot(initial), 'test-read');
    assert.equal(failure.status, 'FAILED');
    assert.equal(context._readPaladinState().state, 'SOFT_PAUSED');
    assert.ok(timers.get('auto_trainer_paladin').dueAt > Date.now());

    context._writePaladinState({ state: 'EXECUTING', nextDueAt: null, reason: 'transmitted' });
    context.runPaladinTrainerWorker = async () => { throw new Error('after boundary'); };
    const recovered = await context.runPaladinTrainerWorkerSafely();
    assert.equal(recovered.status, 'UNCERTAIN');
    assert.equal(context._readPaladinState().state, 'UNCERTAIN');
    assert.ok(timers.get('auto_trainer_paladin').dueAt > Date.now());
});

test('Paladin malformed official state is not mistaken for terminal IDLE', async () => {
    const malformedDocument = createDocument();
    malformedDocument.querySelectorAll = selector => selector === 'script'
        ? [{ textContent: 'receiveKnightsData([], {"1": broken-json});' }]
        : [];
    const context = createContext({
        settings_cookies: { general: { show__auto_paladin_train: { enabled: true, maxLevel: 30 } } },
        PremiumFeaturesPrivateAutomations: true,
        DOMParser: class { parseFromString() { return malformedDocument; } },
        fetch: async () => ({ ok: true, status: 200, url: 'https://en1.tribalwars.net/game.php', text: async () => '<html></html>' })
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/trainerPaladin.js');
    const state = context._writePaladinState({ state: 'IDLE', knightId: '9', trainingEndsAt: null });
    const result = await context.runPaladinTrainerWorker(state.generation, context._paladinSnapshot(state), 'malformed-state');
    assert.equal(result.status, 'FAILED');
    assert.equal(context._readPaladinState().state, 'SOFT_PAUSED');
    assert.ok(timers.get('auto_trainer_paladin').dueAt > Date.now());
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

test('Build Instant confirmed read failure becomes a soft pause with a future wake', async () => {
    const { context, record, timers } = createBuildInstantSystem(() => null);
    context.PremiumFeaturesAsync.runResilientTask = async () => ({ status: 'FAILED' });
    context.checkAndScheduleBuildInstantFree('1', { observeDom: false });
    const initial = timers.get('build_instant_free_1');
    const result = await context.runBuildInstantFreeWorker(...initial.args);
    assert.equal(result.status, 'FAILED');
    assert.equal(record.instant.state, 'SOFT_PAUSED');
    assert.ok(timers.get('build_instant_free_1').dueAt > Date.now());
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

test('server DOM level and cost override a stale persisted target and cached cost', () => {
    const attributes = value => ({ getAttribute: () => String(value) });
    const row = {
        querySelector(selector) {
            if (selector === 'a[data-level-next]') return attributes(25);
            if (selector === '.cost_wood[data-cost]') return attributes(800);
            if (selector === '.cost_stone[data-cost]') return attributes(900);
            if (selector === '.cost_iron[data-cost]') return attributes(700);
            if (selector === '.population') return { parentElement: { textContent: '5' } };
            return null;
        }
    };
    const document = createDocument();
    document.querySelector = selector => {
        if (selector === '#building_wrapper' || selector === '#buildings') return {};
        if (selector === '#main_buildrow_farm') return row;
        return null;
    };
    const storage = createStorage({
        buildings_data: JSON.stringify({ farm: {
            25: { wood: 850, stone: 950, iron: 750, pop: 6 },
            26: { wood: 1000, stone: 1200, iron: 900, pop: 7 }
        } })
    });
    const context = createContext({ document, localStorage: storage, bqGet: () => null });
    load(context, 'widgets/extraBuildQueue.js');
    const decision = context.resolveHeadBuildCost('1', { id: 'head', buildingId: 'farm', targetLevel: 26 }, {
        official: { generation: 4, fetchedAt: Date.now(), currentLevels: { farm: 24 }, queue: [] }
    });
    assert.equal(decision.effectiveLevel, 25);
    assert.equal(decision.source, 'SERVER_DOM');
    assert.equal(decision.authoritative, true);
    assert.deepEqual(JSON.parse(JSON.stringify(decision.cost)), { wood: 800, stone: 900, iron: 700, pop: 5 });
    assert.equal(context.hasEnoughForBuild({ wood: 900, stone: 1000, iron: 800, pop: 0, popMax: 100 }, decision.cost), true);
    assert.deepEqual(JSON.parse(storage.getItem('buildings_data')).farm[25], {
        wood: 800, stone: 900, iron: 700, pop: 5
    });
});

test('fresh background official offer needs zero GET while stale local-only cost cannot authorize mutation', () => {
    let requests = 0;
    const storage = createStorage({
        buildings_data: JSON.stringify({ farm: { 26: { wood: 1000, stone: 1200, iron: 900, pop: 7 } } })
    });
    const context = createContext({
        localStorage: storage,
        bqGet: () => null,
        fetch: async () => { requests++; throw new Error('unexpected request'); }
    });
    load(context, 'widgets/extraBuildQueue.js');
    const head = { id: 'head', buildingId: 'farm', targetLevel: 26 };
    const fresh = context.resolveHeadBuildCost('2', head, {
        official: {
            generation: 7, fetchedAt: Date.now(), queue: [], currentLevels: { farm: 24 },
            nextBuildOffers: { farm: { level: 25, wood: 800, stone: 900, iron: 700, pop: 5, observedAt: Date.now() } }
        }
    });
    assert.equal(fresh.source, 'SERVER_OBSERVATION');
    assert.equal(fresh.effectiveLevel, 25);
    assert.equal(fresh.authoritative, true);
    assert.equal(requests, 0);

    const stale = context.resolveHeadBuildCost('2', head, {
        official: { generation: 7, fetchedAt: Date.now() - 60000, queue: [], currentLevels: {} }
    });
    assert.equal(stale.source, 'LOCAL_TARGET_CACHE');
    assert.equal(stale.authoritative, false);
    assert.equal(requests, 0);
});

test('Building Queue resource observer consumes the initial DOM snapshot immediately', () => {
    const document = createDocument();
    const targets = new Map(['wood', 'stone', 'iron', 'pop_current_label', 'pop_max_label'].map(id => [id, { id }]));
    document.getElementById = id => targets.get(id) || null;
    let record = {
        queue: [{ id: 'head', buildingId: 'farm', targetLevel: 25 }],
        official: { full: true, generation: 1 },
        resources: { wood: 1, stone: 1, iron: 1, pop: 0, popMax: 100, generation: 1 },
        execution: { state: 'WAITING_RESOURCES' }
    };
    let schedules = 0;
    const context = createContext({
        document,
        BUILD_QUEUE_STATE: { WAITING_RESOURCES: 'WAITING_RESOURCES', WAITING_POPULATION: 'WAITING_POPULATION' },
        MutationObserver: class { observe() {} disconnect() {} },
        PremiumFeaturesBuildState: {
            get: () => record,
            updateResources(_villageId, resources) {
                record = Object.assign({}, record, { resources: Object.assign({}, resources, { generation: 2 }) });
            }
        },
        PremiumFeaturesRuntimeRegistry: {
            setObserver(_key, factory) { return factory(); },
            setTimeout(_key, callback) { callback(); }
        },
        bqGet: () => null
    });
    load(context, 'widgets/extraBuildQueue.js');
    context.buildResourceStateFromDoc = () => ({ wood: 900, stone: 1000, iron: 800, pop: 0, popMax: 100, source: 'dom-initial' });
    context.resolveHeadBuildCost = () => ({
        effectiveLevel: 25, cost: { wood: 800, stone: 900, iron: 700, pop: 5 },
        source: 'SERVER_DOM', authoritative: true
    });
    context.ensureBuildQueueController = () => ({ schedule() { schedules++; } });
    context.installBuildQueueResourceObserver();
    assert.equal(record.resources.wood, 900);
    assert.equal(schedules, 1);
});

test('ordinary insufficient DOM resource ticks update local state without reconciliation work', () => {
    const document = createDocument();
    const targets = new Map(['wood', 'stone', 'iron', 'pop_current_label', 'pop_max_label'].map(id => [id, { id }]));
    document.getElementById = id => targets.get(id) || null;
    let record = {
        queue: [{ id: 'head', buildingId: 'farm', targetLevel: 25 }],
        official: { full: false, generation: 1 },
        resources: { wood: 1, stone: 1, iron: 1, pop: 0, popMax: 100, generation: 1 },
        execution: { state: 'WAITING_RESOURCES', nextDueAt: Date.now() + 300000 }
    };
    let schedules = 0;
    const context = createContext({
        document,
        BUILD_QUEUE_STATE: { WAITING_RESOURCES: 'WAITING_RESOURCES', WAITING_POPULATION: 'WAITING_POPULATION' },
        MutationObserver: class { observe() {} disconnect() {} },
        PremiumFeaturesBuildState: {
            get: () => record,
            updateResources(_villageId, resources) {
                record = Object.assign({}, record, { resources: Object.assign({}, resources, { generation: 2 }) });
            },
            calculateResourceEta: () => Date.now() + 300000
        },
        PremiumFeaturesRuntimeRegistry: {
            setObserver(_key, factory) { return factory(); },
            setTimeout(_key, callback) { callback(); }
        },
        bqGet: () => null
    });
    load(context, 'widgets/extraBuildQueue.js');
    context.buildResourceStateFromDoc = () => ({ wood: 2, stone: 2, iron: 2, pop: 0, popMax: 100, source: 'dom-event' });
    context.resolveHeadBuildCost = () => ({
        effectiveLevel: 25, cost: { wood: 800, stone: 900, iron: 700, pop: 5 },
        source: 'SERVER_DOM', authoritative: true
    });
    context.ensureBuildQueueController = () => ({ schedule() { schedules++; } });
    context.installBuildQueueResourceObserver();
    assert.equal(record.resources.wood, 2);
    assert.equal(schedules, 0);
});

test('a known production change advances an older resource ETA without immediate network', () => {
    const document = createDocument();
    const targets = new Map(['wood', 'stone', 'iron', 'pop_current_label', 'pop_max_label'].map(id => [id, { id }]));
    document.getElementById = id => targets.get(id) || null;
    let record = {
        queue: [{ id: 'head', buildingId: 'farm', targetLevel: 25 }],
        official: { full: false, generation: 1 },
        resources: { wood: 1, stone: 1, iron: 1, pop: 0, popMax: 100, generation: 1 },
        execution: { state: 'WAITING_RESOURCES', nextDueAt: Date.now() + 300000 }
    };
    const schedules = [];
    const context = createContext({
        document,
        BUILD_QUEUE_STATE: { WAITING_RESOURCES: 'WAITING_RESOURCES', WAITING_POPULATION: 'WAITING_POPULATION' },
        MutationObserver: class { observe() {} disconnect() {} },
        PremiumFeaturesBuildState: {
            get: () => record,
            updateResources(_villageId, resources) {
                record = Object.assign({}, record, { resources: Object.assign({}, resources, { generation: 2 }) });
            },
            calculateResourceEta: () => Date.now() + 60000
        },
        PremiumFeaturesRuntimeRegistry: {
            setObserver(_key, factory) { return factory(); },
            setTimeout(_key, callback) { callback(); }
        },
        bqGet: () => null
    });
    load(context, 'widgets/extraBuildQueue.js');
    context.buildResourceStateFromDoc = () => ({
        wood: 2, stone: 2, iron: 2, pop: 0, popMax: 100,
        source: 'dom-event', productionSource: 'known-building-completion'
    });
    context.resolveHeadBuildCost = () => ({
        effectiveLevel: 25, cost: { wood: 800, stone: 900, iron: 700, pop: 5 },
        source: 'SERVER_DOM', authoritative: true
    });
    context.ensureBuildQueueController = () => ({ schedule(_villageId, descriptor) { schedules.push(descriptor); } });
    context.installBuildQueueResourceObserver();
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].reason, 'resource-eta-advanced');
    assert.ok(schedules[0].dueAt < record.execution.nextDueAt);
});

test('overview Building Queue tooltip reads the live rearmed due time and real overdue state', () => {
    const context = createContext();
    let execution = { state: 'WAITING_RESOURCES', nextDueAt: Date.now() + 30000 };
    let task = { state: 'QUEUED', dueAt: execution.nextDueAt };
    context.PremiumFeaturesBuildState = { get: () => ({ execution }) };
    context.PremiumFeaturesBackgroundScheduler = { describe: () => task };
    context.BUILD_QUEUE_STATE = {
        RECONCILING: 'RECONCILING', EXECUTING: 'EXECUTING', UNCERTAIN: 'UNCERTAIN',
        SOFT_PAUSED: 'SOFT_PAUSED', WAITING_SLOT: 'WAITING_SLOT',
        WAITING_POPULATION: 'WAITING_POPULATION', WAITING_RESOURCES: 'WAITING_RESOURCES'
    };
    context.ensureBuildQueueController = () => ({ taskKey: villageId => 'build-queue:reconcile:' + villageId });
    context.getBuildQueueTimeoutId = villageId => 'building_queue_' + villageId;
    load(context, 'features/overviewVillages/init.js');
    load(context, 'features/overviewVillages/productionTable.js');

    const first = context.getBuildQueueOverviewWaitingStatus('1');
    assert.equal(first.kind, 'WAITING_RESOURCES');
    assert.ok(first.time);
    const rearmedAt = Date.now() + 60000;
    execution = { state: 'WAITING_RESOURCES', nextDueAt: rearmedAt };
    task = { state: 'QUEUED', dueAt: rearmedAt };
    const rearmed = context.getBuildQueueOverviewWaitingStatus('1');
    assert.equal(rearmed.kind, 'WAITING_RESOURCES');
    assert.equal(rearmed.dueAt, rearmedAt);

    execution = { state: 'WAITING_RESOURCES', nextDueAt: Date.now() - 1000 };
    task = { state: 'OVERDUE', dueAt: execution.nextDueAt };
    assert.equal(context.getBuildQueueOverviewWaitingStatus('1').kind, 'WAITING_RESOURCES');
    task = { state: 'WAITING_LEASE', dueAt: Date.now() + 5000 };
    assert.equal(context.getBuildQueueOverviewWaitingStatus('1').kind, 'WAITING_LEASE');
    task = { state: 'WAITING_LEASE', dueAt: Date.now() - 1 };
    assert.equal(context.getBuildQueueOverviewWaitingStatus('1').kind, 'WAITING_LEASE');
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

test('report hover does not start dispensable work and discards an in-flight visual result', async () => {
    const document = createDocument();
    const popup = { isConnected: true, style: { display: 'none' } };
    document.getElementById = id => id === 'map_popup' ? popup : null;
    let requests = 0;
    let inserts = 0;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const context = createContext({ document, TWMap: undefined });
    load(context, 'features/map/map.js');
    context.TWMap = { popup: { _currentVillage: '1' } };
    context.TWPFMapReports = {
        hydrateFullReport: async report => { requests++; await pending; return report; }
    };
    context.insertReportData = () => { inserts++; };
    const village = { id: '1' };
    const report = { id: '55' };
    assert.equal(await context.hydrateReportForCurrentMapHover(report, village, {}), null);
    assert.equal(requests, 0);

    popup.style.display = 'block';
    const inflight = context.hydrateReportForCurrentMapHover(report, village, {});
    await Promise.resolve();
    assert.equal(requests, 1);
    context.TWMap.popup._currentVillage = '2';
    release();
    await inflight;
    assert.equal(inserts, 0);
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

test('Scavenging lease contention creates an explicit expiry wake with zero network', async () => {
    let requests = 0;
    const leaseExpiresAt = Date.now() + 15000;
    const context = createContext({
        fetch: async () => { requests++; throw new Error('lease contender must not inspect'); },
        PremiumFeaturesCoordination: {
            tabId: 'B', instanceId: 'B1',
            readLease: () => ({ owner: 'A', instanceId: 'A1', expiresAt: leaseExpiresAt })
        }
    });
    const timers = installTimerHarness(context);
    load(context, 'bots/scavenging.js');
    context.saveScavengeConfig({ enabled: true, level: 0, allUnits: true, units: {} }, '11');
    const result = await context.triggerScavengingAuto('11');
    assert.equal(result.status, 'WAITING_LEASE');
    assert.ok(result.dueAt >= leaseExpiresAt);
    assert.equal(timers.get('scavenging-auto:11').handlerName, 'scavengingAutoCheck');
    assert.ok(timers.get('scavenging-auto:11').dueAt >= leaseExpiresAt);
    assert.equal(requests, 0);
});

test('individual Auto Scavenging UI is usable without private automation mode', async () => {
    const ui = createUiDocument();
    const container = ui.makeElement('div');
    container.className = 'scavenge-screen-main-widget';
    ui.document.querySelector = selector => selector === '.scavenge-screen-main-widget' ? container : null;
    ui.document.querySelectorAll = selector => selector === '.scavenge-option' ? [] : [];
    const context = createContext({
        document: ui.document,
        PremiumFeaturesPrivateAutomations: false
    });
    const timers = installTimerHarness(context);
    load(context, 'bots/scavenging.js');
    context.injectScavengeConfigPanel();
    const toggle = ui.document.getElementById('scavenge_config_enabled');
    const start = ui.elements.find(element => element.textContent === 'scavenge.saveAndStart');
    assert.ok(toggle, 'Auto Scavenging toggle was not rendered');
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.checked, false);
    assert.ok(start, 'Save & Start action was not rendered');
    const statusCell = ui.elements.find(element => element.textContent === 'scavenge.statusOff');
    assert.ok(statusCell, 'OFF status must reflect persisted disabled state');
    toggle.checked = true;
    toggle.onchange();
    assert.equal(statusCell.textContent, 'scavenge.statusPendingEnable');
    assert.equal(context.getScavengeConfig('1').enabled, false);
    await start.onclick();
    assert.equal(context.getScavengeConfig('1').enabled, true);
    assert.ok(statusCell.textContent.includes('scavenge.statusActive'));
    assert.ok(timers.has('scavenging-auto:1'));
    toggle.checked = false;
    toggle.onchange();
    assert.equal(context.getScavengeConfig('1').enabled, false);
    assert.equal(statusCell.textContent, 'scavenge.statusOff');
    assert.equal(timers.has('scavenging-auto:1'), false);
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

test('Scavenging mutation HTTP 503 is UNCERTAIN and never blindly repeats the POST', async () => {
    let requests = 0;
    const context = createContext({
        fetch: async () => {
            requests++;
            return { ok: false, status: 503, url: 'https://en1.tribalwars.net/game.php?village=1&screen=scavenge_api' };
        }
    });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/scavenging.js');
    const config = { enabled: false, level: 1, allUnits: false, units: { spear: 10 }, optionId: 1 };
    context.saveScavengeConfig(config, '1');
    const result = await context.sendScavengeSquadApi(
        { spear: 10 }, 1, 250, '1', context._scavengingDecisionHash(config)
    );
    assert.equal(result.uncertain, true);
    assert.equal(requests, 1);
    assert.equal(context.getScavengeConfig('1').uncertain.status, 503);
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

test('Daily confirmed read failure becomes a soft pause with a future wake', async () => {
    const context = createContext({ settings_cookies: { general: { show__auto_daily_bonus: true } } });
    const timers = installTimerHarness(context);
    load(context, 'utils/core_async.js');
    load(context, 'bots/dailyBonus.js');
    context.PremiumFeaturesAsync.runResilientTask = async () => ({ status: 'FAILED' });
    context.checkAndScheduleDailyBonus();
    const initial = timers.get('daily_bonus');
    const result = await context.runDailyBonusWorker(...initial.args);
    assert.equal(result.status, 'FAILED');
    assert.equal(context._dailyReadState().status, 'SOFT_PAUSED');
    assert.ok(timers.get('daily_bonus').dueAt > Date.now());
});

test('automatic mutations revalidate their enabled setting immediately before network', async () => {
    let requests = 0;
    const paladin = createContext({
        settings_cookies: { general: { show__auto_paladin_train: { enabled: true, maxLevel: 30 } } },
        fetch: async () => { requests++; throw new Error('unexpected Paladin mutation'); }
    });
    installTimerHarness(paladin);
    load(paladin, 'utils/core_async.js');
    load(paladin, 'bots/trainerPaladin.js');
    const paladinState = paladin._writePaladinState({ state: 'IDLE', knightId: '9', trainingEndsAt: null });
    paladin.settings_cookies.general.show__auto_paladin_train.enabled = false;
    assert.equal((await paladin._startPaladinTraining('9', '3', 90, paladinState)).status, 'DISABLED');

    const instantSystem = createBuildInstantSystem(() => null);
    instantSystem.context.fetch = async () => { requests++; throw new Error('unexpected Build Instant mutation'); };
    instantSystem.context.settings_cookies.general.show__auto_build_instant_free = false;
    const official = instantSystem.record.official;
    assert.equal((await instantSystem.context.buildInstantFreeApiCall(
        '44', '1', official.generation, instantSystem.context._buildInstantSnapshot('1', official)
    )).status, 'DISABLED');

    const daily = createContext({
        settings_cookies: { general: { show__auto_daily_bonus: true } },
        fetch: async () => { requests++; throw new Error('unexpected Daily mutation'); }
    });
    installTimerHarness(daily);
    load(daily, 'utils/core_async.js');
    load(daily, 'bots/dailyBonus.js');
    const dailyState = daily._dailyWriteState({ serverDay: daily._dailyServerDay(), status: 'UNKNOWN' });
    daily.settings_cookies.general.show__auto_daily_bonus = false;
    assert.equal((await daily._collectDailyBonus(1, dailyState)).status, 'DISABLED');
    assert.equal(requests, 0);
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
    const leaseDeferred = await context.runKeepAwakeCheck(8);
    assert.equal(leaseDeferred.status, 'WAITING_LEASE');
    assert.ok(leaseDeferred.dueAt > Date.now());
    assert.equal(timers.get('keep-awake').handlerName, 'keepAwakeCheck');
    assert.ok(timers.get('keep-awake').waitMs >= 10000);
    assert.equal(reloads, 0);
    const source = fs.readFileSync(path.join(ROOT, 'utils/core_utils.js'), 'utf8');
    assert.doesNotMatch(source, /setInterval\('keep-awake:check'/);
});

test('Keep Awake confirmation releases its wait and yields to due automation', async () => {
    let reloads = 0;
    let higherPriorityDue = false;
    const context = createContext({
        settings_cookies: { general: { keep_awake: true, redirect__train_buildings: false } },
        TribalWars: { getIdleTime: () => 999999 },
        PremiumFeaturesBackgroundScheduler: {
            PRIORITY: { HOUSEKEEPING: 5 },
            hasPendingHigherPriority: () => higherPriorityDue
        },
        location: {
            href: 'https://en1.tribalwars.net/game.php?village=1&screen=overview',
            hostname: 'en1.tribalwars.net', host: 'en1.tribalwars.net', origin: 'https://en1.tribalwars.net',
            reload() { reloads++; }
        }
    });
    const timers = installTimerHarness(context);
    context.PremiumFeaturesCoordination = {
        tabId: 'A', instanceId: 'A1',
        readLease: () => ({ owner: 'A', instanceId: 'A1', expiresAt: Date.now() + 30000 })
    };
    load(context, 'utils/core_utils.js');
    const warning = await context.runKeepAwakeCheck(8);
    assert.equal(warning.status, 'CONFIRMATION_SCHEDULED');
    assert.equal(timers.get('keep-awake-confirm').waitMs, 5000);
    assert.equal(reloads, 0);

    higherPriorityDue = true;
    const deferred = await context.runKeepAwakeConfirmation(8);
    assert.equal(deferred.status, 'DEFERRED_FOR_BACKGROUND_WORK');
    assert.equal(reloads, 0);
    assert.equal(timers.get('keep-awake-confirm').waitMs, 5000);

    higherPriorityDue = false;
    const completed = await context.runKeepAwakeConfirmation(8);
    assert.equal(completed.status, 'RELOADING');
    assert.equal(reloads, 1);
});

test('Keep Awake lease lost during confirmation always rearms the confirmation wake', async () => {
    let reloads = 0;
    const context = createContext({
        settings_cookies: { general: { keep_awake: true, redirect__train_buildings: false } },
        TribalWars: { getIdleTime: () => 999999 },
        location: {
            href: 'https://en1.tribalwars.net/game.php?village=1&screen=overview',
            hostname: 'en1.tribalwars.net', host: 'en1.tribalwars.net', origin: 'https://en1.tribalwars.net',
            reload() { reloads++; }
        }
    });
    const timers = installTimerHarness(context);
    context.PremiumFeaturesCoordination = {
        tabId: 'B', instanceId: 'B1',
        readLease: () => ({ owner: 'A', instanceId: 'A1', expiresAt: Date.now() + 12000 })
    };
    load(context, 'utils/core_utils.js');
    const deferred = await context.runKeepAwakeConfirmation(8);
    assert.equal(deferred.status, 'WAITING_LEASE');
    assert.equal(timers.get('keep-awake-confirm').handlerName, 'keepAwakeConfirmation');
    assert.ok(timers.get('keep-awake-confirm').dueAt >= deferred.dueAt);
    assert.equal(reloads, 0);
});

(async () => {
    let failed = 0;
    const pattern = process.env.TEST_PATTERN || '';
    const selectedTests = pattern ? tests.filter(item => item.name.includes(pattern)) : tests;
    for (let index = 0; index < selectedTests.length; index++) {
        const item = selectedTests[index];
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
    else console.log('\n' + selectedTests.length + ' automation tests passed');
})();

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeClock {
    constructor(now = 0) {
        this.now = now;
        this.nextId = 1;
        this.timers = new Map();
    }

    setTimeout(fn, delay = 0) {
        const id = this.nextId++;
        this.timers.set(id, { fn, at: this.now + Math.max(0, Number(delay) || 0), interval: 0 });
        return id;
    }

    clearTimeout(id) { this.timers.delete(id); }

    setInterval(fn, delay = 0) {
        const id = this.nextId++;
        const interval = Math.max(1, Number(delay) || 1);
        this.timers.set(id, { fn, at: this.now + interval, interval });
        return id;
    }

    clearInterval(id) { this.timers.delete(id); }

    nextTimer(beforeOrAt = Infinity) {
        return Array.from(this.timers.entries())
            .filter(([, timer]) => timer.at <= beforeOrAt)
            .sort((first, second) => first[1].at - second[1].at || first[0] - second[0])[0] || null;
    }

    runNext(beforeOrAt = Infinity) {
        const next = this.nextTimer(beforeOrAt);
        if (!next) return false;
        const [id, timer] = next;
        this.now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else this.timers.delete(id);
        timer.fn();
        return true;
    }

    tick(ms) {
        const target = this.now + ms;
        let safety = 10000;
        while (this.runNext(target)) {
            if (--safety === 0) throw new Error('Fake clock runaway');
        }
        this.now = target;
    }
}

function createStorage(initial = {}) {
    const data = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
    const storage = {
        get length() { return data.size; },
        key(index) { return Array.from(data.keys())[index] ?? null; },
        getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
        setItem(key, value) {
            const normalizedKey = String(key);
            const normalizedValue = String(value);
            data.set(normalizedKey, normalizedValue);
            Object.defineProperty(storage, normalizedKey, {
                configurable: true,
                enumerable: true,
                get: () => data.get(normalizedKey)
            });
        },
        removeItem(key) {
            data.delete(String(key));
            delete storage[String(key)];
        },
        clear() {
            Array.from(data.keys()).forEach(key => storage.removeItem(key));
        },
        dump() { return Object.fromEntries(data); }
    };
    Object.entries(initial).forEach(([key, value]) => storage.setItem(key, value));
    return storage;
}

function createEventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        dispatch(type, event = {}) { listeners.get(type)?.forEach(fn => fn(Object.assign({ type }, event))); },
        listenerCount(type) { return listeners.get(type)?.size || 0; }
    };
}

function jqueryStub() {
    function makeCollection() {
        return {
            length: 0,
            off() { return this; },
            on() { return this; },
            ready(fn) { fn(); return this; },
            data() { return undefined; },
            keydown() { return this; },
            find() { return makeCollection(); },
            sortable() { return this; }
        };
    }
    const jquery = function () { return makeCollection(); };
    jquery.ajax = function () { throw new Error('Unexpected ajax'); };
    return jquery;
}

function createContext({ storage = createStorage(), clock = new FakeClock(), overrides = {} } = {}) {
    const windowEvents = createEventTarget();
    const documentEvents = createEventTarget();
    const document = Object.assign(documentEvents, {
        hidden: false,
        body: {},
        location: { href: 'https://pt99.tribalwars.com.pt/game.php?village=1&screen=main' },
        getElementById() { return null; },
        getElementsByTagName() { return []; },
        getElementsByClassName() { return []; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    });
    let uuidCounter = 0;
    const FakeDate = class extends Date {
        constructor(...args) { super(...(args.length ? args : [clock.now])); }
        static now() { return clock.now; }
    };
    const context = {
        console,
        Promise,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Uint32Array,
        Object,
        Array,
        Math,
        JSON,
        Number,
        String,
        Boolean,
        RegExp,
        Error,
        TypeError,
        URL,
        Date: FakeDate,
        localStorage: storage,
        document,
        location: { href: document.location.href, hostname: 'pt99.tribalwars.com.pt' },
        crypto: { randomUUID: () => 'uuid-' + (++uuidCounter) },
        setTimeout: clock.setTimeout.bind(clock),
        clearTimeout: clock.clearTimeout.bind(clock),
        setInterval: clock.setInterval.bind(clock),
        clearInterval: clock.clearInterval.bind(clock),
        queueMicrotask,
        requestAnimationFrame: fn => clock.setTimeout(fn, 0),
        cancelAnimationFrame: id => clock.clearTimeout(id),
        $: jqueryStub(),
        ...windowEvents,
        ...overrides
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    return { context, clock, storage, document, windowEvents };
}

function load(context, relativePath) {
    const filename = path.join(ROOT, relativePath);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}

async function flushMicrotasks(rounds = 5) {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
}

async function drainTimers(clock, limit = 200) {
    for (let i = 0; i < limit; i++) {
        if (!clock.runNext()) {
            await flushMicrotasks();
            if (!clock.runNext()) return;
        }
        await flushMicrotasks();
    }
    throw new Error('Timer drain limit exceeded');
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function loadCore(context) {
    load(context, 'utils/core_runtime.js');
    load(context, 'utils/core_coordination.js');
    load(context, 'utils/core_async.js');
    load(context, 'utils/core_scheduler.js');
}

test('restore persisted A/B dispatches the correct handlers', async () => {
    const storage = createStorage();
    const first = createContext({ storage });
    loadCore(first.context);
    vm.runInContext(`
        registerTimeoutHandler('A', function () {});
        registerTimeoutHandler('B', function () {});
        setHandlerOnTimeOut('A', 'A', [], 100, 0, 0);
        setHandlerOnTimeOut('B', 'B', [], 200, 0, 0);
    `, first.context);

    const restored = createContext({ storage, clock: new FakeClock(0) });
    restored.context.events = [];
    loadCore(restored.context);
    vm.runInContext(`
        registerTimeoutHandler('A', function () { events.push('A'); });
        registerTimeoutHandler('B', function () { events.push('B'); });
        restoreTimeouts();
        restoreTimeouts();
    `, restored.context);
    assert.deepEqual(Object.keys(restored.context.activeTimeouts).sort(), ['A', 'B']);
    await drainTimers(restored.clock);
    assert.deepEqual(Array.from(restored.context.events), ['A', 'B']);
    assert.equal(Object.keys(restored.context.activeTimeouts).length, 0);
});

test('replacing timer A fences and cancels the old callback', async () => {
    const env = createContext();
    env.context.events = [];
    loadCore(env.context);
    vm.runInContext(`
        registerTimeoutHandler('oldA', function () { events.push('old'); });
        registerTimeoutHandler('newA', function () { events.push('new'); });
        setHandlerOnTimeOut('replace-A', 'oldA', [], 100, 0, 0);
        setHandlerOnTimeOut('replace-A', 'newA', [], 150, 0, 0);
    `, env.context);
    await drainTimers(env.clock);
    assert.deepEqual(Array.from(env.context.events), ['new']);
});

test('start called five times installs one logical lifecycle', () => {
    const env = createContext();
    load(env.context, 'utils/core_runtime.js');
    const counters = { prepare: 0, ui: 0, background: 0, observers: 0 };
    const scheduler = { marker: 'single-scheduler' };
    Object.assign(env.context, {
        BACKGROUND_TASK_PRIORITY: { AUTOMATIC: 3, REFRESH: 4 },
        PremiumFeaturesBackgroundScheduler: scheduler,
        PremiumFeaturesCoordination: {
            registerBackgroundTask() { counters.background++; },
            isCoordinator() { return true; }
        },
        game_data: { village: { id: 1 }, player: { villages: 1 }, link_base_pure: '/game.php?village=1&screen=', csrf: 'x' },
        settings_cookies: {
            widgets: [],
            general: {
                keep_awake: true,
                redirect__train_buildings: false,
                show__auto_daily_bonus: false,
                show__auto_paladin_train: { enabled: false },
                show__player_profile_stats: false
            }
        },
        serverTimezoneOffsetMs: 0,
        detectServerTimezoneOffsetMs: () => 0,
        prepareVillageList: () => { counters.prepare++; },
        listenTextAreas() {},
        setCookieCurrentVillage() {},
        checkEarlyBuildOpportunity() {},
        captureCurrentVillageMarketTransports() {},
        injectOverviewVillagesTopbarMenu() {},
        addRessourcesHover() {},
        insertNavigationArrows: () => { counters.ui++; },
        insertListVillagesPopup() {},
        injectNavigationBar() {},
        defineKeyboardShortcuts() {},
        injectScriptSettingsPopUp() {},
        registerWidgetPopupSidebarShortcuts() {},
        fetchAndCacheWorldSettings: async () => ({}),
        updateAllMapData: async () => {},
        storeUnitsInfo() {},
        fetchAndCacheBuildingsData: async () => ({}),
        localStorage: createStorage({ villages_info: '[]', settings_cookies: JSON.stringify({ widgets: [], general: { keep_awake: true } }) })
    });
    env.context.window.PremiumFeaturesCoordination = env.context.PremiumFeaturesCoordination;
    env.context.window.PremiumFeaturesBackgroundScheduler = scheduler;
    load(env.context, 'utils/core_utils.js');

    const target = createEventTarget();
    const registry = env.context.window.PremiumFeaturesRuntimeRegistry;
    registry.addEventListener('test:listener', target, 'change', function () {});
    registry.addEventListener('test:listener', target, 'change', function () {});
    registry.setObserver('test:observer', function () { counters.observers++; return { disconnect() {} }; });
    registry.setObserver('test:observer', function () { counters.observers++; return { disconnect() {} }; });
    for (let i = 0; i < 5; i++) env.context.start();

    assert.equal(counters.prepare, 1);
    assert.equal(counters.ui, 1);
    assert.equal(counters.background, 6);
    assert.equal(counters.observers, 1);
    assert.equal(target.listenerCount('change'), 1);
    assert.equal(registry.stats().intervals, 1);
    assert.strictEqual(env.context.window.PremiumFeaturesBackgroundScheduler, scheduler);
});

test('two tabs compete, fail over, and reject stale fencing', () => {
    const env = createContext();
    load(env.context, 'utils/core_runtime.js');
    load(env.context, 'utils/core_coordination.js');
    let now = 1000;
    const shared = createStorage();
    const common = { storage: shared, now: () => now, host: env.context, heartbeatMs: 1000, coordinatorLeaseMs: 3000 };
    const tabA = env.context.createTabCoordinator({ ...common, tabId: 'A', instanceId: 'A1' });
    const tabB = env.context.createTabCoordinator({ ...common, tabId: 'B', instanceId: 'B1' });

    const leaseA = tabA.acquireLease('build-queue:123', 3000);
    assert.ok(leaseA);
    assert.equal(tabB.acquireLease('build-queue:123', 3000), null);
    now = 5000;
    const leaseB = tabB.acquireLease('build-queue:123', 3000);
    assert.ok(leaseB);
    assert.ok(leaseB.token > leaseA.token);
    assert.equal(tabA.validateLease(leaseA), false);
    assert.throws(() => tabA.assertLease(leaseA), error => error.code === 'LEASE_LOST');

    assert.equal(tabA.evaluateCoordinator(), true);
    assert.equal(tabB.evaluateCoordinator(), false);
    now = 9001;
    assert.equal(tabB.evaluateCoordinator(), true);
    assert.equal(tabA.isCoordinator(), false);
});

test('single-flight shares the exact Promise and executes once', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    const singleFlight = env.context.PremiumFeaturesAsync.createSingleFlight();
    let calls = 0;
    let release;
    const deferred = new Promise(resolve => { release = resolve; });
    const first = singleFlight.run('screen=main:village=1', () => { calls++; return deferred; });
    const second = singleFlight.run('screen=main:village=1', () => { calls++; return Promise.resolve('wrong'); });
    assert.strictEqual(first, second);
    assert.equal(calls, 0);
    await flushMicrotasks();
    assert.equal(calls, 1);
    release('ok');
    assert.equal(await second, 'ok');
});

test('cache exposes fresh, stale-usable and expired states per resource policy', () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    let now = 1000;
    const cache = env.context.PremiumFeaturesAsync.createResourceCache({ now: () => now });
    cache.set('village:1', { wood: 10 });
    const policy = { freshForMs: 100, staleForMs: 200 };
    assert.equal(cache.read('village:1', policy).state, 'FRESH');
    now = 1150;
    assert.equal(cache.read('village:1', policy).state, 'STALE_BUT_USABLE');
    now = 1400;
    assert.equal(cache.read('village:1', policy).state, 'EXPIRED');
});

test('circuit breaker opens only for repeated same-snapshot failures', () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    let now = 0;
    const breaker = env.context.PremiumFeaturesAsync.createCircuitBreaker({ now: () => now, threshold: 3 });
    breaker.recordFailure('paladin', 'snapshot-a', { status: 503 });
    breaker.recordFailure('paladin', 'snapshot-a', { status: 503 });
    assert.equal(breaker.getState('paladin').state, 'CLOSED');
    breaker.recordFailure('paladin', 'snapshot-a', { status: 503 });
    assert.equal(breaker.getState('paladin').state, 'OPEN');
    assert.equal(breaker.canRun('paladin', 'snapshot-a'), false);
    assert.equal(breaker.canRun('paladin', 'snapshot-b'), true);
    assert.equal(breaker.getState('paladin').failureCount, 0);
});

test('timeout soft-pauses without immediate retry', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    let calls = 0;
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const breaker = env.context.PremiumFeaturesAsync.createCircuitBreaker({ now: () => 1000 });
    const result = await env.context.runResilientTask({
        key: 'reports-sync',
        snapshot: { page: 1 },
        breaker,
        run: async () => { calls++; throw timeout; }
    });
    assert.equal(result.status, 'SOFT_PAUSED');
    assert.equal(result.retryAt, 31000);
    assert.equal(calls, 1);
});

test('POST timeout becomes UNCERTAIN and schedules one reconciliation', async () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    let calls = 0;
    const queued = [];
    const timeout = new Error('post timed out');
    timeout.name = 'TimeoutError';
    const breaker = env.context.PremiumFeaturesAsync.createCircuitBreaker({ now: () => 0 });
    const result = await env.context.runResilientTask({
        key: 'build-instant:1',
        snapshot: { orderId: 9 },
        mutation: true,
        timeout: true,
        leaseKey: 'build-instant:1',
        breaker,
        scheduler: { PRIORITY: { RECONCILIATION: 2 }, enqueue: task => queued.push(task) },
        reconcile: async () => 'checked',
        run: async () => { calls++; throw timeout; }
    });
    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(calls, 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].priority, 2);
});

test('same-origin 429 performs zero retries and hard-stops', async () => {
    let ajaxCalls = 0;
    let hardStops = 0;
    const jquery = jqueryStub();
    jquery.ajax = settings => {
        ajaxCalls++;
        settings.error({ status: 429, responseURL: 'https://pt99.tribalwars.com.pt/game.php' });
    };
    const env = createContext({ overrides: { $: jquery } });
    env.context.PremiumFeaturesBotProtection = { block: () => { hardStops++; } };
    env.context.PremiumFeaturesBackgroundScheduler = { hardStop: () => { hardStops++; } };
    load(env.context, 'utils/core_async.js');
    await assert.rejects(env.context.fetchWithRetry429({ url: '/game.php', type: 'GET' }));
    assert.equal(ajaxCalls, 1);
    assert.equal(hardStops, 2);
});

test('403/429 hard-stop policy is restricted to same-origin Tribal Wars', () => {
    const env = createContext();
    load(env.context, 'utils/core_async.js');
    const classify = env.context.PremiumFeaturesAsync.classifyRequestFailure;
    assert.equal(classify({ status: 403 }, { url: '/game.php' }).hardStop, true);
    assert.equal(classify({ status: 429 }, { url: 'https://api.example.com/data' }).hardStop, false);
    const transient = classify({ status: 503 }, { url: '/game.php' });
    assert.equal(transient.transient, true);
    assert.equal(transient.hardStop, false);
});

test('resume processes overdue work one task per deterministic turn', async () => {
    const env = createContext();
    loadCore(env.context);
    const starts = [];
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context,
        clock: env.clock,
        now: () => env.clock.now,
        autoStart: false,
        turnGapMs: 100,
        concurrency: 1
    });
    scheduler.start();
    scheduler.pause();
    for (let i = 0; i < 6; i++) {
        scheduler.enqueue({ key: 'overdue-' + i, priority: 3, dueAt: 0, run: () => { starts.push(env.clock.now); } });
    }
    scheduler.resume();
    env.clock.tick(0);
    await flushMicrotasks();
    assert.equal(starts.length, 1);
    env.clock.tick(99);
    await flushMicrotasks();
    assert.equal(starts.length, 1);
    env.clock.tick(1);
    await flushMicrotasks();
    assert.equal(starts.length, 2);
    await drainTimers(env.clock);
    assert.equal(starts.length, 6);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 100);
});

test('manual and reconciliation work outrank automatic background work', async () => {
    const env = createContext();
    loadCore(env.context);
    const order = [];
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context,
        clock: env.clock,
        now: () => env.clock.now,
        autoStart: false,
        turnGapMs: 10,
        concurrency: 1
    });
    scheduler.start();
    scheduler.pause();
    scheduler.enqueue({ key: 'housekeeping', priority: 5, run: () => order.push('housekeeping') });
    scheduler.enqueue({ key: 'automatic', priority: 3, run: () => order.push('automatic') });
    scheduler.enqueue({ key: 'manual', priority: 1, run: () => order.push('manual') });
    scheduler.enqueue({ key: 'reconcile', priority: 2, run: () => order.push('reconcile') });
    scheduler.resume();
    await drainTimers(env.clock);
    assert.deepEqual(order, ['manual', 'reconcile', 'automatic', 'housekeeping']);
});

test('editing pauses only tasks bound to that UI scope', async () => {
    const env = createContext();
    loadCore(env.context);
    const order = [];
    const runtime = env.context.createRuntimeRegistry({ clock: env.clock });
    const scheduler = env.context.createCooperativeScheduler({
        host: env.context,
        runtime,
        clock: env.clock,
        now: () => env.clock.now,
        autoStart: false,
        turnGapMs: 10,
        interactionDeferMs: 100,
        concurrency: 1
    });
    scheduler.start();
    runtime.beginInteraction('build-editor');
    scheduler.enqueue({ key: 'related', priority: 1, interactionScope: 'build-editor', run: () => order.push('related') });
    scheduler.enqueue({ key: 'unrelated', priority: 3, run: () => order.push('unrelated') });
    env.clock.tick(0);
    await flushMicrotasks();
    assert.deepEqual(order, ['unrelated']);
    runtime.endInteraction('build-editor');
    await drainTimers(env.clock);
    assert.deepEqual(order, ['unrelated', 'related']);
});

test('write-behind consolidates rapid writes and idle infrastructure makes no requests', () => {
    const storage = createStorage();
    let ajaxCalls = 0;
    const jquery = jqueryStub();
    jquery.ajax = () => { ajaxCalls++; };
    const env = createContext({ storage, overrides: { $: jquery } });
    loadCore(env.context);
    const writer = env.context.createWriteBehindStore({ storage, clock: env.clock, delayMs: 50 });
    writer.set('state', 'one');
    writer.set('state', 'two');
    writer.set('state', 'three');
    assert.equal(writer.pendingCount(), 1);
    assert.equal(storage.getItem('state'), null);
    env.clock.tick(50);
    assert.equal(storage.getItem('state'), 'three');
    assert.equal(ajaxCalls, 0);
});

test('main userscript require graph resolves locally and Premium Compat remains present', () => {
    const main = fs.readFileSync(path.join(ROOT, 'main.user.js'), 'utf8');
    const requires = Array.from(main.matchAll(/^\/\/ @require\s+https:\/\/raw\.githubusercontent\.com\/jpmartins98\/Tribalwars-Premium-Features\/master\/(.+)$/gm), match => match[1]);
    assert.ok(requires.length > 0);
    requires.forEach(relativePath => assert.ok(fs.existsSync(path.join(ROOT, relativePath)), 'missing @require ' + relativePath));
    assert.match(main, /Premium Features \[Premium Compat\]/);
    const queue = fs.readFileSync(path.join(ROOT, 'widgets/extraBuildQueue.js'), 'utf8');
    assert.match(queue, /game_data\?\.features\?\.Premium\?\.active \? 5 : 2/);
});

(async () => {
    let passed = 0;
    for (const current of tests) {
        try {
            await current.fn();
            passed++;
            console.log('ok', passed, '-', current.name);
        } catch (error) {
            console.error('not ok', passed + 1, '-', current.name);
            throw error;
        }
    }
    console.log(`\n${passed} core runtime tests passed`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

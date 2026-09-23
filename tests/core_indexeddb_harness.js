'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'core_indexeddb.js'), 'utf8');

function fakeIndexedDb({ version = 7, blocked = false, corrupt = false } = {}) {
    const stores = new Map();
    const names = { contains: name => stores.has(name) };
    function makeStore(keyPath = null) {
        const indexes = new Map();
        return {
            keyPath,
            indexNames: { contains: name => indexes.has(name) },
            createIndex(name, indexKeyPath) {
                const index = { keyPath: indexKeyPath };
                indexes.set(name, index);
                return index;
            },
            index(name) {
                if (!indexes.has(name)) throw new Error(`Missing index ${name}`);
                return indexes.get(name);
            }
        };
    }
    stores.set('build_queue', makeStore());
    stores.set('world_reports', makeStore());
    const db = {
        version,
        closed: false,
        objectStoreNames: names,
        createObjectStore(name, options = {}) {
            if (stores.has(name)) throw new Error(`Duplicate store ${name}`);
            const store = makeStore(options.keyPath ?? null);
            stores.set(name, store);
            return store;
        },
        transaction(names) {
            const requested = Array.isArray(names) ? names : [names];
            if (requested.some(name => !stores.has(name))) throw new Error(`Missing store ${requested}`);
            const transaction = {
                aborted: false,
                objectStore: name => stores.get(name),
                abort() {
                    this.aborted = true;
                    queueMicrotask(() => this.onabort?.());
                }
            };
            setTimeout(() => {
                if (!transaction.aborted) transaction.oncomplete?.();
            }, 0);
            return transaction;
        },
        close() { this.closed = true; }
    };
    const factory = {
        requests: [],
        open(name, requestedVersion) {
            assert.equal(name, 'tw_premium_features');
            db.closed = false;
            const request = {
                result: db,
                transaction: { objectStore: storeName => stores.get(storeName) }
            };
            this.requests.push(request);
            queueMicrotask(() => {
                if (blocked) {
                    request.onblocked?.();
                    // An upgrade can complete later; a rejected opener must close it.
                }
                if (version < requestedVersion) {
                    db.version = requestedVersion;
                    request.onupgradeneeded?.();
                }
                if (corrupt) stores.delete('autofarm_mutations');
                request.onsuccess?.();
            });
            return request;
        }
    };
    return { factory, db, stores };
}

function scriptWith(factory) {
    const context = vm.createContext({ indexedDB: factory, console, Promise, window: {} });
    vm.runInContext(source, context, { filename: 'core_indexeddb.js' });
    return context;
}

async function run() {
    {
        const { factory, db, stores } = fakeIndexedDb();
        const script = scriptWith(factory);
        assert.equal(vm.runInContext('isTwDbSchemaReady()', script), false);
        const opened = await vm.runInContext('openTwDb()', script);
        assert.equal(opened, db);
        assert.equal(db.version, 9);
        assert.equal(stores.has('world_reports'), true, 'legacy data store retained');
        assert.equal(vm.runInContext('isTwDbSchemaReady()', script), true);
        for (const name of [
            'autofarm_meta', 'autofarm_farms', 'autofarm_dispatches', 'autofarm_reports',
            'autofarm_events', 'autofarm_operational', 'autofarm_mutations', 'autofarm_diagnostics'
        ]) assert.equal(stores.has(name), true, `${name} created`);
        assert.equal(stores.get('autofarm_mutations').indexNames.contains('by_round'), true);
        for (const name of ['autofarm_farms', 'autofarm_dispatches', 'autofarm_reports',
            'autofarm_events', 'autofarm_mutations', 'autofarm_diagnostics']) {
            assert.equal(stores.get(name).indexNames.contains('by_village'), true, `${name}.by_village created`);
        }
        assert.equal(await vm.runInContext('openTwDb()', script), db);
        assert.equal(factory.requests.length, 1, 'connection cached');
        const request = { result: 42 };
        const committed = vm.runInContext('runAutoFarmDbTransaction(["autofarm_meta"], "readwrite", api => { api.onRequest(globalRequest, value => api.setResult(value)); })',
            Object.assign(script, { globalRequest: request }));
        let committedYet = false;
        committed.then(() => { committedYet = true; });
        queueMicrotask(() => request.onsuccess());
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(committedYet, false, 'request success is not a committed write');
        assert.equal(await committed, 42, 'resolves only after transaction completion');
        await assert.rejects(
            vm.runInContext('runAutoFarmDbTransaction(["autofarm_meta"], "readwrite", api => api.abort(new Error("fenced")))', script),
            { message: 'fenced' }
        );
        await assert.rejects(
            vm.runInContext('runAutoFarmDbTransaction(["autofarm_meta"], "readwrite", () => Promise.resolve())', script),
            { code: 'IDB_TRANSACTION_ASYNC_CALLBACK' }
        );
        await assert.rejects(
            vm.runInContext('runAutoFarmDbTransaction(["world_reports"], "readonly", () => {})', script),
            { code: 'IDB_TRANSACTION_INVALID' }
        );
        db.onversionchange();
        assert.equal(db.closed, true);
        assert.equal(vm.runInContext('isTwDbSchemaReady()', script), false);
        assert.equal(await vm.runInContext('openTwDb()', script), db, 'reopens after versionchange');
        assert.equal(factory.requests.length, 2);
    }
    {
        const { factory, db } = fakeIndexedDb({ blocked: true });
        const script = scriptWith(factory);
        await assert.rejects(vm.runInContext('openTwDb()', script), { code: 'IDB_UPGRADE_BLOCKED' });
        assert.equal(vm.runInContext('isTwDbSchemaReady()', script), false);
        assert.equal(db.closed, true, 'late success after blocked is closed');
    }
    {
        const { factory, db } = fakeIndexedDb({ corrupt: true });
        const script = scriptWith(factory);
        await assert.rejects(vm.runInContext('openTwDb()', script), { code: 'IDB_SCHEMA_INCOMPLETE' });
        assert.equal(vm.runInContext('isTwDbSchemaReady()', script), false);
        assert.equal(db.closed, true);
    }
    {
        const script = scriptWith(undefined);
        await assert.rejects(vm.runInContext('openTwDb()', script), { code: 'IDB_UNAVAILABLE' });
        assert.equal(vm.runInContext('isTwDbSchemaReady()', script), false);
    }
    console.log('core_indexeddb_harness: 4 cases passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

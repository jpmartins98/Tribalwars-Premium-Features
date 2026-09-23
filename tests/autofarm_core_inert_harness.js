'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptiveCore.js'), 'utf8');
let timers = 0;
let listeners = 0;
let fetches = 0;
let writes = 0;
const storage = {
    getItem() { return null; },
    setItem() { writes++; },
    removeItem() { writes++; },
    get length() { return 0; },
    key() { return null; }
};
const context = vm.createContext({
    console,
    Date,
    Math,
    Promise,
    URL,
    URLSearchParams,
    Uint32Array,
    window: null,
    location: { host: 'pt99.tribalwars.com.pt', origin: 'https://pt99.tribalwars.com.pt', href: 'https://pt99.tribalwars.com.pt/game.php' },
    document: {},
    localStorage: storage,
    sessionStorage: storage,
    crypto: { randomUUID: () => 'fixture-tab', getRandomValues(array) { array[0] = 1; return array; } },
    setTimeout() { timers++; return 1; },
    clearTimeout() {},
    setInterval() { timers++; return 1; },
    clearInterval() {},
    addEventListener() { listeners++; },
    fetch() { fetches++; throw new Error('semantic core must not fetch'); }
});
context.window = context;
context.globalThis = context;
vm.runInContext(source, context, { filename: 'autoFarmAdaptiveCore.js' });

const api = context.PremiumFeaturesAutoFarmAdaptiveCore;
assert.ok(api, 'semantic core exported');
assert.equal(api.VERSION, '2.0.15');
assert.equal(timers, 0, 'semantic core starts no timer');
assert.equal(listeners, 0, 'semantic core registers no listener');
assert.equal(fetches, 0, 'semantic core performs no network');
assert.equal(writes, 0, 'semantic core performs no storage write');
assert.equal(api.normalizeCfg({ farmTemplate: 'C' }).farmTemplate, 'A', 'template C remains fail-closed');
assert.equal(api.normalizeCfg({ enabled: true }).enabled, true);
console.log('autofarm_core_inert_harness: semantic core is inert');

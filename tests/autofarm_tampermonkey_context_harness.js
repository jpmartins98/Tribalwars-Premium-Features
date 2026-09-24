'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptive.js'), 'utf8');

function fakeDocument() {
    const byId = new Map();
    class Element {
        constructor(tag) {
            this.tagName = String(tag).toUpperCase();
            this.dataset = {};
            this.children = [];
            this._innerHTML = '';
        }
        set innerHTML(value) { this._innerHTML = String(value); }
        get innerHTML() { return this._innerHTML; }
        addEventListener() {}
        remove() { if (this.id) byId.delete(this.id); }
        querySelector() { return { textContent: '', value: '', dataset: {}, classList: { toggle() {} } }; }
        querySelectorAll() { return []; }
        appendChild(node) {
            this.children.push(node);
            if (node.id) byId.set(node.id, node);
            return node;
        }
    }
    return {
        body: new Element('body'),
        createElement(tag) { return new Element(tag); },
        getElementById(id) { return byId.get(String(id)) || null; }
    };
}

const document = fakeDocument();
const never = new Promise(() => {});
const storageService = {
    readRecord() { return never; }
};

let registered = 0;
const windowObject = {
    document,
    location: {
        host: 'pt117.tribalwars.com.pt',
        origin: 'https://pt117.tribalwars.com.pt',
        href: 'https://pt117.tribalwars.com.pt/game.php?village=23888&screen=overview'
    },
    PremiumFeaturesAutoFarmStorage: { create() { return storageService; } },
    PremiumFeaturesBackgroundScheduler: {
        PRIORITY: { MANUAL: 1, RECONCILIATION: 2, AUTOMATIC: 3 },
        registerHandler() { registered++; },
        stats() { return { hardStopped: false }; }
    }
};

const context = vm.createContext({
    console,
    Promise,
    Date,
    Math,
    URL,
    URLSearchParams,
    AbortController,
    window: windowObject,
    document,
    location: windowObject.location,
    // Important: page data exists lexically, but NOT on sandbox window.
    game_data: {
        player: { id: 849091665 },
        village: { id: 23888, coord: '580|601' }
    }
});

vm.runInContext(`
    const settings_cookies = { general: { show__auto_farm_adaptive: true } };
    function getSetting(name) { return settings_cookies.general[name]; }
`, context);

assert.equal(windowObject.game_data, undefined, 'fixture must not mirror game_data onto sandbox window');
vm.runInContext(source, context, { filename: 'autoFarmAdaptive.js' });

const api = windowObject.PremiumFeaturesAutoFarmAdaptive;
assert.ok(api, 'AutoFarm controller exported');
assert.deepEqual(
    JSON.parse(JSON.stringify(api.currentScope())),
    { world: 'pt117.tribalwars.com.pt', playerId: '849091665', sourceVillageId: '23888' },
    'currentScope resolves lexical game_data when window.game_data is unavailable'
);

api.init();
assert.equal(registered, 1, 'scheduler handler registered');
assert.ok(
    document.getElementById('twpf-autofarm-adaptive'),
    'AutoFarm STARTING shell mounts before async storage even with lexical-only game_data'
);

console.log('autofarm_tampermonkey_context_harness: PASS');

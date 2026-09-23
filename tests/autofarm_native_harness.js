'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptive.js'), 'utf8');

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
    console.log('autofarm_native_harness: 1 lifecycle/safety suite passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

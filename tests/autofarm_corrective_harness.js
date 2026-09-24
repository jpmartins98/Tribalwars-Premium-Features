'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const coreSource = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptiveCore.js'), 'utf8');
const plannerSource = fs.readFileSync(path.join(__dirname, '..', 'features', 'autoFarmAdaptivePlanner.js'), 'utf8');

let fetches = 0;
const inertStorage = {
    getItem() { return null; }, setItem() {}, removeItem() {},
    get length() { return 0; }, key() { return null; }
};
const context = vm.createContext({
    console, Date, Math, Promise, URL, URLSearchParams, Uint32Array,
    window: null, globalThis: null,
    location: { host: 'pt99.tribalwars.com.pt', origin: 'https://pt99.tribalwars.com.pt', href: 'https://pt99.tribalwars.com.pt/game.php' },
    document: {}, localStorage: inertStorage, sessionStorage: inertStorage,
    crypto: { randomUUID: () => 'fixture', getRandomValues(array) { array[0] = 123456789; return array; } },
    setTimeout() { throw new Error('pure planner must not arm timers'); }, clearTimeout() {},
    setInterval() { throw new Error('pure planner must not arm intervals'); }, clearInterval() {},
    addEventListener() { throw new Error('pure planner must not install listeners'); },
    fetch() { fetches++; throw new Error('pure planner must not use the network'); }
});
context.window = context;
context.globalThis = context;
vm.runInContext(coreSource, context, { filename: 'autoFarmAdaptiveCore.js' });
vm.runInContext(plannerSource, context, { filename: 'autoFarmAdaptivePlanner.js' });
const core = context.PremiumFeaturesAutoFarmAdaptiveCore;
const planner = context.PremiumFeaturesAutoFarmPlanner;

function seededRandomSource(seed, namespace) {
    let value = seed >>> 0;
    let draws = 0;
    const nextFloat = () => {
        value += 0x6D2B79F5;
        let mixed = value;
        mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
        draws++;
        return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
    };
    return {
        namespace,
        nextFloat,
        nextInt(min, max) {
            const lo = Math.ceil(Math.min(min, max));
            const hi = Math.floor(Math.max(min, max));
            return lo + Math.floor(nextFloat() * Math.max(1, hi - lo + 1));
        },
        chooseWeighted(options) {
            const list = options.filter(option => Number(option.weight) > 0);
            let cursor = nextFloat() * list.reduce((sum, option) => sum + Number(option.weight), 0);
            for (const option of list) {
                cursor -= Number(option.weight);
                if (cursor <= 0) return option.value;
            }
            return list.at(-1).value;
        },
        timestampBetween(start, end) {
            return Math.min(start, end) + nextFloat() * Math.abs(end - start);
        },
        get drawCount() { return draws; },
        get draws() { return draws; }
    };
}

function intent(seed, mode, overrides = {}, sources = null) {
    const randomSources = sources || {
        coalescing: seededRandomSource(seed, 'coalescing'),
        scheduling: seededRandomSource(seed ^ 0x9E3779B9, 'scheduling')
    };
    return planner.createDesiredIntent({
        now: 1_000_000,
        mode,
        executionRoundId: overrides.executionRoundId || 'round-1',
        generation: 7,
        planRevision: 12,
        immutableNotBeforeAt: 1_000_000,
        nextMutationNotBeforeAt: overrides.nextMutationNotBeforeAt || 0,
        candidateRefs: overrides.candidateRefs || [
            { coord: '501|500', targetId: '91', templateId: '7', reason: 'EXPLOIT' },
            { coord: '502|500', targetId: '92', templateId: '7', reason: 'LEARNING' },
            { coord: '503|500', targetId: '93', templateId: '7', reason: 'COVERAGE' }
        ],
        knownDispatchBudget: 3,
        configuredMaximum: 30,
        intentId: overrides.intentId,
        stochasticDecisionId: overrides.stochasticDecisionId,
        reason: overrides.reason || 'SEEDED_FIXTURE',
        ...overrides
    }, randomSources);
}

function run() {
    assert.ok(core && planner);
    assert.equal(fetches, 0, 'loading core/planner is zero-network');

    const immediate = [];
    const adaptive = [];
    for (let seed = 1; seed <= 80; seed++) {
        immediate.push(intent(seed, 'IMMEDIATE_EFFICIENCY').intent);
        adaptive.push(intent(seed, 'ADAPTIVE_SPREAD').intent);
    }
    const immediateDelays = immediate.map(item => item.desiredDelayMs);
    const adaptiveDelays = adaptive.map(item => item.desiredDelayMs);
    assert.ok(immediateDelays.every(delay => delay > 0 && delay <= 10 * 60000));
    assert.ok(adaptiveDelays.every(delay => delay > 0 && delay <= 45 * 60000));
    assert.ok(new Set(immediateDelays.map(Math.round)).size > 20, 'Immediate remains stochastic');
    assert.ok(new Set(immediate.map(item => item.temporalProfile)).size > 1, 'Immediate uses multiple early profiles');
    assert.ok(new Set(adaptive.map(item => item.temporalProfile)).size >= 5, 'Adaptive spans temporal regions');
    assert.ok(adaptiveDelays.some(delay => delay > 120000), 'Adaptive desired timing is not clamped to proof TTL');
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.ok(average(immediateDelays) < average(adaptiveDelays), 'Immediate is biased earlier than Adaptive');
    assert.equal(fetches, 0, 'stochastic drawing/coalescing performs no GET');

    const zeroGap = intent(91, 'IMMEDIATE_EFFICIENCY', { nextMutationNotBeforeAt: 0 }).intent;
    assert.ok(zeroGap.desiredExecutionAt > zeroGap.stochasticAnchorAt,
        'attemptGapMs=0 does not collapse stochastic timing to now');
    const positiveGap = intent(92, 'IMMEDIATE_EFFICIENCY', { nextMutationNotBeforeAt: 1_008_000 }).intent;
    assert.ok(positiveGap.stochasticAnchorAt >= 1_008_000);
    assert.ok(positiveGap.desiredExecutionAt > positiveGap.stochasticAnchorAt,
        'attemptGap is a lower bound, not a replacement for stochastic offset');

    const persisted = intent(100, 'ADAPTIVE_SPREAD').intent;
    const serialized = JSON.parse(JSON.stringify(persisted));
    const restored = planner.desiredIntentFromLegacy({ desiredIntent: serialized });
    for (const field of ['intentId', 'stochasticDecisionId', 'desiredExecutionAt', 'temporalProfile',
        'stochasticSubwindowStart', 'stochasticSubwindowEnd', 'randomDrawCount']) {
        assert.equal(restored[field], persisted[field], `reload preserves ${field}`);
    }
    const followerRandom = seededRandomSource(333, 'failover-follower');
    const followerDraws = followerRandom.drawCount;
    const failoverRestored = planner.desiredIntentFromLegacy({ desiredIntent: serialized });
    assert.equal(failoverRestored.intentId, persisted.intentId);
    assert.equal(failoverRestored.stochasticDecisionId, persisted.stochasticDecisionId);
    assert.equal(failoverRestored.desiredExecutionAt, persisted.desiredExecutionAt);
    assert.equal(followerRandom.drawCount, followerDraws, 'lease failover restores with zero RNG draws');
    const manualSource = seededRandomSource(400, 'manual-proof');
    const drawsBeforeManual = manualSource.drawCount;
    for (let count = 0; count < 10; count++) {
        const decision = planner.manualReevaluationDecision({
            state: 'WAITING_EXECUTION', desiredIntent: persisted,
            executionRound: { status: 'OPEN', pendingMutation: null }
        }, 1_000_500 + count);
        assert.equal(decision.action, 'PRESERVE_WAIT');
        assert.equal(decision.redraw, false);
        assert.equal(decision.dueAt, persisted.desiredExecutionAt);
    }
    assert.equal(manualSource.drawCount, drawsBeforeManual, 'manual reevaluation adds zero RNG draws');

    const deadlines = {
        executionDueAt: 1_030_000,
        reportDueAt: 1_020_000,
        maintenanceDueAt: 1_040_000,
        reconcileDueAt: 1_020_000
    };
    assert.equal(planner.nextDeadline(deadlines).kind, 'RECONCILIATION');
    const due = planner.dueDeadlines(deadlines, 1_020_000);
    assert.deepEqual(Array.from(due, item => item.kind), ['RECONCILIATION', 'REPORT']);
    const afterReport = planner.clearDeadline(deadlines, 'REPORT');
    assert.equal(afterReport.executionDueAt, 1_030_000, 'REPORT wake preserves stochastic execution deadline');
    assert.equal(persisted.stochasticDecisionId, restored.stochasticDecisionId, 'REPORT/local deadline work cannot redraw');

    const sameMap = [['501|500', '9'], ['502|500', '10']];
    assert.equal(planner.stableHash(sameMap), planner.stableHash(JSON.parse(JSON.stringify(sameMap))),
        'identical MAP refresh preserves content revision even when observation revision changes');

    const proofContext = { sourceVillageId: '1', templateId: '7', farmTemplate: 'A' };
    const totalOnly = {
        value: 2, exact: true, authoritative: true, source: 'ASSISTANT_CURRENT_UNITS',
        observedAt: 990000, freshUntil: 1_100_000, ...proofContext,
        availableAtHome: false, currentUnits: { spear: 250, sword: 250 },
        derivedFrom: 'TOTAL_SUPPORT_AWAY_COUNTERS'
    };
    assert.equal(planner.selectUsableCapacityProof(totalOnly, proofContext, 1_000_000), null,
        'total/support/away troops never prove units available at home');
    const atHome = { ...totalOnly, availableAtHome: true, authority: 'AM_FARM_FRESH_CURRENT_UNITS' };
    assert.equal(planner.selectUsableCapacityProof(atHome, proofContext, 1_000_000).value, 2);
    const minimumOne = {
        ...proofContext,
        value: 1, exact: false, authoritative: true,
        source: 'ASSISTANT_MINIMUM_ONE', observedAt: 999000, freshUntil: 1_045_000,
        availableAtHome: true, authority: 'AM_FARM_FRESH_ENABLED_BUTTON_MINIMUM_ONE'
    };
    const selectedMinimum = planner.selectUsableCapacityProof(minimumOne, proofContext, 1_000_000, 5000);
    assert.equal(selectedMinimum?.value, 1,
        'ASSISTANT_MINIMUM_ONE is a usable lower-bound proof even though exact=false');
    assert.equal(selectedMinimum?.exact, false);
    const unsafeMinimum = { ...minimumOne, availableAtHome: false };
    assert.equal(planner.selectUsableCapacityProof(unsafeMinimum, proofContext, 1_000_000), null,
        'minimum-one without at-home authority cannot authorize a mutation');
    const nearExpiry = { ...atHome, source: 'POST_CURRENT_UNITS', observedAt: 999999, freshUntil: 1_000_500 };
    const durable = { ...minimumOne, observedAt: 990000, freshUntil: 1_100_000 };
    assert.equal(planner.selectUsableCapacityProof([nearExpiry, durable], proofContext, 1_000_000, 1000).value, 1,
        'proof selection can choose a durable minimum-one over an exact proof that misses the planning margin');

    const round = core.normalizeExecutionRound({
        executionRoundId: 'round-capacity', configuredLimit: 30,
        dispatchLimitRemaining: 30, status: 'OPEN'
    });
    const oneProof = core.normalizeCapacityProof({
        ...atHome, value: 1, observedAt: 999000, freshUntil: 1_100_000
    });
    assert.equal(round.dispatchLimitRemaining, 30);
    assert.equal(core.successorDispatchBudget(round, oneProof, 20, proofContext, 1_000_000), 1);
    assert.equal(round.dispatchLimitRemaining, 30, 'CapacityProof does not redefine the round ceiling');
    const postPlan = core.normalizeExecutionPlan({
        sourceVillageId: '1', templateId: '7', farmTemplate: 'A',
        composition: { spear: 5, sword: 2 }, compositionAuthoritative: true
    });
    const postProof = core.capacityProofAfterConfirmedPost(oneProof,
        { spear: 25, sword: 10 }, postPlan, 1_000_000);
    assert.equal(postProof.source, 'POST_CURRENT_UNITS');
    assert.equal(postProof.value, 5);
    assert.equal(postProof.availableAtHome, true);
    assert.equal(core.capacityProofAfterConfirmedPost(oneProof, null, postPlan, 1_000_000), null,
        'confirmed mutation without authoritative current_units invalidates instead of decrementing locally');
    const zeroProof = core.serverNoUnitsCapacityProof(postPlan, '1', 1_000_000);
    assert.equal(zeroProof.value, 0);
    assert.equal(zeroProof.source, 'SERVER_NO_UNITS');
    assert.equal(zeroProof.templateId, '7');
    assert.equal(zeroProof.compositionAuthoritative, true);

    const mutation = {
        targetCoord: '501|500', reportIdAtSend: '100', startedAt: 1_000_000,
        composition: { spear: 5, sword: 2 }
    };
    const indexEntry = { reportId: '101', targetCoord: '501|500', assistantAttackAt: 1_001_000 };
    const matchingDetail = {
        timestamp: 1_001_000, sourceCoord: '500|500', composition: { spear: 5, sword: 2 }
    };
    assert.equal(planner.reportMatchesMutation(indexEntry, matchingDetail, mutation, '500|500'), true);
    assert.equal(planner.reportMatchesMutation(indexEntry, { ...matchingDetail, sourceCoord: '499|500' }, mutation, '500|500'), false,
        'manual/external report from another source does not imply SENT');
    assert.equal(planner.reportMatchesMutation(indexEntry, { ...matchingDetail, composition: { spear: 10 } }, mutation, '500|500'), false);
    assert.equal(planner.reportMatchesMutation({ ...indexEntry, reportId: '100' }, matchingDetail, mutation, '500|500'), false);

    const coalescing = seededRandomSource(700, 'successor-coalescing');
    const scheduling = seededRandomSource(701, 'successor-scheduling');
    const sharedSources = { coalescing, scheduling };
    const first = intent(0, 'ADAPTIVE_SPREAD', {
        executionRoundId: 'same-round', intentId: 'intent-1', stochasticDecisionId: 'decision-1'
    }, sharedSources).intent;
    const drawsAfterFirst = coalescing.drawCount + scheduling.drawCount;
    const second = intent(0, 'ADAPTIVE_SPREAD', {
        executionRoundId: 'same-round', intentId: 'intent-2', stochasticDecisionId: 'decision-2',
        candidateRefs: [{ coord: '502|500', targetId: '92', templateId: '7', reason: 'SUCCESSOR' }]
    }, sharedSources).intent;
    assert.equal(first.executionRoundId, second.executionRoundId);
    assert.notEqual(first.intentId, second.intentId);
    assert.notEqual(first.stochasticDecisionId, second.stochasticDecisionId);
    assert.ok(coalescing.drawCount + scheduling.drawCount > drawsAfterFirst,
        'a successor in the same round consumes a new stochastic decision');

    const fixtureRandom = core.createRandomSource([0.1, 0.2, 0.3], 'fixture');
    fixtureRandom.nextFloat();
    fixtureRandom.nextInt(1, 3);
    assert.equal(fixtureRandom.drawCount, 2, 'central RandomSource exposes actual draw count');
    assert.equal(fetches, 0, 'all stochastic waiting/planning fixtures remain zero-network');
    console.log('autofarm_corrective_harness: 18 stochastic/deadline/proof/matching cases passed');
}

run();

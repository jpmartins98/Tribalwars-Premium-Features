// Pure AutoFarm planning primitives. This module owns no lifecycle, network,
// storage, DOM, timer or scheduler side effects.
(function (root) {
    'use strict';

    const STOCHASTIC_POLICY_VERSION = 1;
    const POLICY_WINDOWS = Object.freeze({
        IMMEDIATE_EFFICIENCY: Object.freeze({ minDelayMs: 15000, maxDelayMs: 10 * 60000 }),
        ADAPTIVE_SPREAD: Object.freeze({ minDelayMs: 30000, maxDelayMs: 45 * 60000 })
    });
    const DEADLINES = Object.freeze([
        { field: 'reconcileDueAt', kind: 'RECONCILIATION', priority: 0 },
        { field: 'capacityDueAt', kind: 'CAPACITY', priority: 1 },
        { field: 'authorizationDueAt', kind: 'AUTHORIZATION', priority: 2 },
        { field: 'executionDueAt', kind: 'EXECUTION', priority: 3 },
        { field: 'reportDueAt', kind: 'REPORT', priority: 4 },
        { field: 'maintenanceDueAt', kind: 'MAINTENANCE', priority: 5 },
        { field: 'observationDueAt', kind: 'OBSERVATION', priority: 6 },
        { field: 'leaseRecoveryDueAt', kind: 'LEASE_RECOVERY', priority: 7 }
    ]);

    function core() {
        const value = root.PremiumFeaturesAutoFarmAdaptiveCore;
        if (!value) throw new Error('AutoFarm core unavailable');
        return value;
    }

    function stableSerialize(value) {
        if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }

    function stableHash(value) {
        const text = stableSerialize(value);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function compactCandidateRef(candidate) {
        return {
            coord: String(candidate?.coord || ''),
            targetId: String(candidate?.targetId || ''),
            templateId: String(candidate?.templateId || ''),
            reason: String(candidate?.reason || '')
        };
    }

    function createDesiredIntent(input, randomSources = {}) {
        const c = core();
        const timestamp = Math.max(0, Number(input?.now) || Date.now());
        const mode = String(input?.mode || '') === 'IMMEDIATE_EFFICIENCY'
            ? 'IMMEDIATE_EFFICIENCY'
            : 'ADAPTIVE_SPREAD';
        const policy = POLICY_WINDOWS[mode];
        const stochasticAnchorAt = Math.max(
            timestamp,
            Number(input?.immutableNotBeforeAt) || 0,
            Number(input?.nextMutationNotBeforeAt) || 0,
            Number(input?.functionalLowerBoundAt) || 0
        );
        const candidateRefs = (Array.isArray(input?.candidateRefs) ? input.candidateRefs : [])
            .map(compactCandidateRef);
        if (!candidateRefs.length) throw new Error('DesiredIntent requires candidates');
        const candidateSetRevision = String(input?.candidateSetRevision || stableHash(candidateRefs));
        const coalescing = randomSources.coalescing || c.createRandomSource(null, 'coalescing');
        const scheduling = randomSources.scheduling || c.createRandomSource(null, 'scheduling');
        const stochastic = c.generateStochasticPlan({
            now: timestamp,
            mode,
            cycleId: String(input?.cycleId || ''),
            generation: input?.generation,
            planRevision: input?.planRevision,
            ownerId: String(input?.ownerId || ''),
            earliestExecutionAt: stochasticAnchorAt + policy.minDelayMs,
            latestCheapExecutionAt: stochasticAnchorAt + policy.maxDelayMs,
            maxHoldAt: stochasticAnchorAt + policy.maxDelayMs,
            knownDispatchBudget: input?.knownDispatchBudget,
            readyCandidateCount: candidateRefs.length,
            configuredMaximum: input?.configuredMaximum,
            randomSources: { coalescing, scheduling }
        }, scheduling);
        const desiredExecutionAt = Math.max(stochasticAnchorAt, Number(stochastic.executionDueAt) || 0);
        if (!(desiredExecutionAt > stochasticAnchorAt)) throw new Error('Stochastic policy produced no future execution time');
        const createdAt = timestamp;
        const intentId = String(input?.intentId || [
            input?.executionRoundId, input?.generation, createdAt, candidateSetRevision
        ].join(':'));
        const stochasticDecisionId = String(input?.stochasticDecisionId || `${intentId}:policy-${STOCHASTIC_POLICY_VERSION}`);
        const intent = c.normalizeDesiredIntent({
            intentId,
            stochasticDecisionId,
            executionRoundId: input?.executionRoundId,
            generation: input?.generation,
            mode,
            createdAt,
            stochasticPolicyVersion: STOCHASTIC_POLICY_VERSION,
            stochasticAnchorAt,
            desiredDelayMs: desiredExecutionAt - stochasticAnchorAt,
            desiredExecutionAt,
            temporalProfile: stochastic.temporalProfile,
            stochasticSubwindowStart: stochastic.stochasticSubwindowStart,
            stochasticSubwindowEnd: stochastic.stochasticSubwindowEnd,
            coalesceTarget: stochastic.coalesceTarget,
            coalesceUntil: stochastic.coalesceUntil,
            candidateRefs,
            candidateSetRevision,
            modelRevision: input?.modelRevision,
            configRevision: input?.configRevision,
            nextMutationNotBeforeAt: input?.nextMutationNotBeforeAt,
            randomDrawCount: Number(coalescing.drawCount ?? coalescing.draws) +
                Number(scheduling.drawCount ?? scheduling.draws),
            reason: input?.reason,
            intentCreatedBecause: input?.intentCreatedBecause || input?.reason
        });
        return { intent, stochastic };
    }

    function desiredIntentFromLegacy(state) {
        const existing = state?.desiredIntent ? core().normalizeDesiredIntent(state.desiredIntent) : null;
        if (existing?.intentId && existing.desiredExecutionAt > 0) return existing;
        const stochastic = state?.stochasticPlan;
        const plan = state?.executionPlan;
        if (!stochastic || !plan || !(Number(stochastic.executionDueAt) > 0)) return null;
        const candidateRefs = (plan.candidates || []).map(compactCandidateRef);
        return core().normalizeDesiredIntent({
            intentId: `legacy:${plan.cycleId || plan.executionRoundId}`,
            stochasticDecisionId: `legacy:${plan.cycleId || plan.executionRoundId}:preserved`,
            executionRoundId: plan.executionRoundId,
            generation: plan.generation,
            mode: stochastic.mode,
            createdAt: stochastic.createdAt || plan.createdAt,
            stochasticPolicyVersion: STOCHASTIC_POLICY_VERSION,
            stochasticAnchorAt: stochastic.localWindowStart || plan.notBeforeAt,
            desiredExecutionAt: stochastic.executionDueAt,
            desiredDelayMs: Math.max(0, Number(stochastic.executionDueAt) - Number(stochastic.localWindowStart || plan.notBeforeAt || 0)),
            temporalProfile: stochastic.temporalProfile,
            stochasticSubwindowStart: stochastic.stochasticSubwindowStart,
            stochasticSubwindowEnd: stochastic.stochasticSubwindowEnd,
            coalesceTarget: stochastic.coalesceTarget,
            coalesceUntil: stochastic.coalesceUntil,
            candidateRefs,
            candidateSetRevision: stableHash(candidateRefs),
            configRevision: plan.sourceRevisions?.settings,
            reason: 'compatible-policy-upgrade',
            intentCreatedBecause: 'PRESERVED_LEGACY_STOCHASTIC_PLAN',
            randomDrawCount: 0
        });
    }

    function deadlineEntries(state) {
        return DEADLINES.map(item => ({ ...item, dueAt: Math.max(0, Number(state?.[item.field]) || 0) }))
            .filter(item => item.dueAt > 0);
    }

    function nextDeadline(state) {
        return deadlineEntries(state).sort((a, b) => a.dueAt - b.dueAt || a.priority - b.priority)[0] || null;
    }

    function dueDeadlines(state, timestamp = Date.now()) {
        return deadlineEntries(state)
            .filter(item => item.dueAt <= Number(timestamp))
            .sort((a, b) => a.priority - b.priority || a.dueAt - b.dueAt);
    }

    function clearDeadline(state, kind) {
        const match = DEADLINES.find(item => item.kind === String(kind));
        return match ? { ...state, [match.field]: 0 } : { ...state };
    }

    function capacityRequiresAtHomeAuthority(proof) {
        return Number(proof?.value) > 0 && [
            'POST_CURRENT_UNITS', 'ASSISTANT_CURRENT_UNITS', 'ASSISTANT_MINIMUM_ONE'
        ].includes(String(proof?.source || ''));
    }

    function selectUsableCapacityProof(proofs, context = {}, timestamp = Date.now(), marginMs = 0) {
        const usableAt = Number(timestamp) + Math.max(0, Number(marginMs) || 0);
        const candidates = (Array.isArray(proofs) ? proofs : [proofs])
            .filter(Boolean)
            .map(value => core().normalizeCapacityProof(value))
            .filter(proof => core().capacityProofContextMatches(proof, context))
            .filter(proof => proof.authoritative && proof.exact && proof.observedAt > 0 && proof.freshUntil >= usableAt)
            .filter(proof => !capacityRequiresAtHomeAuthority(proof) || proof.availableAtHome === true);
        const sourceStrength = { SERVER_NO_UNITS: 5, POST_CURRENT_UNITS: 5, ASSISTANT_CURRENT_UNITS: 4, ASSISTANT_MINIMUM_ONE: 2 };
        candidates.sort((a, b) =>
            Number(sourceStrength[b.source] || 0) - Number(sourceStrength[a.source] || 0) ||
            Number(b.observedAt) - Number(a.observedAt) || Number(b.freshUntil) - Number(a.freshUntil));
        return candidates[0] || null;
    }

    function authorizationRequirements(state, plan, timestamp = Date.now(), marginMs = 0) {
        const at = Number(timestamp) + Math.max(0, Number(marginMs) || 0);
        const candidate = plan?.candidates?.[0];
        const map = state?.sources?.MAP;
        const assistant = state?.sources?.ASSISTANT;
        const template = state?.sources?.TEMPLATE;
        const context = {
            sourceVillageId: plan?.sourceVillageId,
            templateId: plan?.templateId,
            farmTemplate: plan?.farmTemplate
        };
        const capacity = selectUsableCapacityProof(state?.sources?.CAPACITY?.data, context, timestamp, marginMs);
        const required = [];
        if (!map || map.invalidated || map.status !== 'READY' || Number(map.data?.authorizationFreshUntil || 0) < at ||
            String(map.data?.targetIds?.[candidate?.coord] || '') !== String(candidate?.targetId || '')) required.push('MAP');
        if (!assistant || assistant.invalidated || assistant.status !== 'READY' || Number(assistant.freshUntil || 0) < at) required.push('ASSISTANT');
        if (!template || template.invalidated || template.status !== 'READY' || Number(template.freshUntil || 0) < at) required.push('TEMPLATE');
        if (!capacity) required.push('CAPACITY');
        return { required: [...new Set(required)], capacity, authorized: required.length === 0 && Number(capacity?.value) > 0 };
    }

    function manualReevaluationDecision(state, timestamp = Date.now()) {
        const intent = state?.desiredIntent ? core().normalizeDesiredIntent(state.desiredIntent) : null;
        if (state?.executionRound?.pendingMutation || ['UNKNOWN', 'RECONCILING'].includes(String(state?.state))) {
            return { action: 'RECONCILE', redraw: false };
        }
        if (intent?.intentId && intent.desiredExecutionAt > timestamp) {
            return { action: 'PRESERVE_WAIT', redraw: false, dueAt: intent.desiredExecutionAt };
        }
        if (intent?.intentId) return { action: 'AUTHORIZE', redraw: false, dueAt: timestamp };
        return { action: 'OBSERVE', redraw: false, dueAt: timestamp };
    }

    function reportMatchesMutation(indexEntry, detail, mutation, expectedSourceCoord, pendingTimeoutHours = 12) {
        if (!indexEntry?.reportId || String(indexEntry.targetCoord || '') !== String(mutation?.targetCoord || '')) return false;
        const baseline = String(mutation?.reportIdAtSend || '');
        if (baseline && core().adaptiveReportIdRelation(indexEntry.reportId, baseline) !== 1) return false;
        const startedAt = Number(mutation?.startedAt || mutation?.preparedAt || 0);
        const reportAt = Number(detail?.timestamp || indexEntry.assistantAttackAt || 0);
        if (!(startedAt > 0) || !(reportAt >= startedAt - 2 * 60000) ||
            reportAt > startedAt + Math.max(1, Number(pendingTimeoutHours) || 12) * 3600000) return false;
        if (!expectedSourceCoord || String(detail?.sourceCoord || '') !== String(expectedSourceCoord)) return false;
        if (!mutation?.composition || !detail?.composition ||
            !core().sameComposition(mutation.composition, detail.composition)) return false;
        return true;
    }

    root.PremiumFeaturesAutoFarmPlanner = Object.freeze({
        STOCHASTIC_POLICY_VERSION, POLICY_WINDOWS, DEADLINES,
        stableHash, compactCandidateRef, createDesiredIntent, desiredIntentFromLegacy,
        deadlineEntries, nextDeadline, dueDeadlines, clearDeadline,
        selectUsableCapacityProof, authorizationRequirements,
        manualReevaluationDecision, reportMatchesMutation
    });
})(window);

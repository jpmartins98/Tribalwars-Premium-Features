// Bot: Auto Build Instant Free — event-driven, generation-fenced and multi-tab safe.

const BUILD_INSTANT_FREE_WINDOW_SEC = 180;
const BUILD_INSTANT_COMPLETION_MARGIN_MS = 2000;

function _buildInstantStateApi() {
    return window.PremiumFeaturesBuildState;
}

function _buildInstantEnabled() {
    return Boolean(settings_cookies?.general?.show__auto_build_instant_free);
}

function _buildInstantTaskId(villageId) {
    return 'build_instant_free_' + String(villageId);
}

function _buildInstantSnapshot(villageId, official) {
    const value = {
        villageId: String(villageId),
        generation: Number(official?.generation) || 0,
        queue: official?.queue || [],
        slots: official?.slots || [],
        cancelIds: official?.cancelIds || [],
        nextSlotAt: Number(official?.nextSlotAt) || null
    };
    return window.PremiumFeaturesAsync?.stableSnapshotHash?.(value) || JSON.stringify(value);
}

function _buildInstantLeaseActive(villageId) {
    const coordinator = window.PremiumFeaturesCoordination;
    if (!coordinator?.readLease) return true;
    const lease = coordinator.readLease('build-instant:' + String(villageId));
    return Boolean(lease && lease.owner === coordinator.tabId &&
        lease.instanceId === coordinator.instanceId && lease.expiresAt > Date.now());
}

function _throwBuildInstantResponse(response, url) {
    if (response?.ok) return response;
    const error = new Error('HTTP ' + (response?.status || 0));
    error.status = Number(response?.status) || 0;
    error.url = response?.url || url;
    throw error;
}

function _buildInstantRequest(fields, run) {
    return window.PremiumFeaturesDiagnostics?.request
        ? window.PremiumFeaturesDiagnostics.request(fields, run)
        : Promise.resolve().then(run);
}

function _setBuildInstantState(villageId, patch, immediate) {
    return _buildInstantStateApi()?.setInstant?.(String(villageId), patch, immediate);
}

function _clearBuildInstantFreeTimeout(villageId) {
    const id = _buildInstantTaskId(villageId || game_data?.village?.id);
    if (typeof clearPersistedTimeout === 'function') clearPersistedTimeout(id);
}

function _scheduleBuildInstantWorker(villageId, dueAt, reason, official, extra = {}) {
    const vId = String(villageId);
    const state = _buildInstantStateApi();
    const currentOfficial = official || state?.get(vId)?.official || {};
    const generation = Number(currentOfficial.generation) || 0;
    const snapshotHash = _buildInstantSnapshot(vId, currentOfficial);
    const targetAt = Math.max(Date.now(), Number(dueAt) || Date.now());
    _setBuildInstantState(vId, Object.assign({
        state: reason === 'window-open' ? 'CHECKING' : 'WAITING_WINDOW',
        nextDueAt: targetAt,
        checkedOfficialGeneration: Number(extra.checkedOfficialGeneration) || 0,
        snapshotHash,
        reason,
        uncertain: extra.uncertain || null
    }, extra.statePatch || {}), true);
    setHandlerOnTimeOut(
        _buildInstantTaskId(vId),
        'instantFreeWorker',
        [vId, generation, snapshotHash, reason, extra.orderId || null],
        Math.max(0, targetAt - Date.now())
    );
}

/** Rebuilds the one relevant timer without fetching merely because the page reloaded. */
function checkAndScheduleBuildInstantFree(villageId, options = {}) {
    const vId = String(villageId || game_data?.village?.id || '');
    if (!vId) return { status: 'NO_VILLAGE' };
    if (!_buildInstantEnabled()) {
        _clearBuildInstantFreeTimeout(vId);
        _setBuildInstantState(vId, { state: 'IDLE', nextDueAt: null, reason: 'disabled', uncertain: null }, true);
        return { status: 'DISABLED' };
    }

    const state = _buildInstantStateApi();
    if (vId == String(game_data?.village?.id || '') &&
        document.querySelector('#building_wrapper') && document.querySelector('#buildings') &&
        typeof observeBuildQueueDocument === 'function' && options.observeDom !== false) {
        const cached = state?.get(vId);
        if (cached?.official?.source !== 'dom' || Date.now() - Number(cached.official.fetchedAt || 0) > 1000) {
            observeBuildQueueDocument(document, vId, 'dom');
        }
    }

    const record = state?.get(vId);
    const official = record?.official || {};
    const instant = record?.instant || {};
    if (instant.state === 'UNCERTAIN') {
        const dueAt = Math.max(Date.now(), Number(instant.nextDueAt) || Date.now());
        const orderId = instant.uncertain?.orderId || instant.orderId || null;
        _scheduleBuildInstantWorker(vId, dueAt, 'uncertain-reconcile', official, {
            orderId,
            uncertain: instant.uncertain,
            statePatch: { state: 'UNCERTAIN', orderId: orderId != null ? String(orderId) : null }
        });
        return { status: 'UNCERTAIN', dueAt };
    }
    const nextSlotAt = Number(official.nextSlotAt || bqGet('building_queue_next_slot', vId)) || 0;
    if (!nextSlotAt || nextSlotAt <= Date.now()) {
        _clearBuildInstantFreeTimeout(vId);
        _setBuildInstantState(vId, { state: 'IDLE', nextDueAt: null, reason: 'no-active-build', uncertain: null }, true);
        return { status: 'IDLE' };
    }

    const freeAt = nextSlotAt - BUILD_INSTANT_FREE_WINDOW_SEC * 1000;
    if (Date.now() < freeAt) {
        _scheduleBuildInstantWorker(vId, freeAt, 'known-free-window', official);
        return { status: 'WAITING_WINDOW', dueAt: freeAt };
    }

    const snapshotHash = _buildInstantSnapshot(vId, official);
    if (instant.state === 'STALE' && instant.snapshotHash === snapshotHash &&
        Number(instant.checkedOfficialGeneration) === Number(official.generation)) {
        const dueAt = Math.max(Date.now(), nextSlotAt + BUILD_INSTANT_COMPLETION_MARGIN_MS);
        if (!localStorage.getItem('endTime_' + _buildInstantTaskId(vId))) {
            _scheduleBuildInstantWorker(vId, dueAt, 'known-completion', official, {
                checkedOfficialGeneration: official.generation,
                statePatch: { state: 'STALE' }
            });
        }
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'build-instant', villageId: vId, taskKey: 'build-instant:' + vId,
            status: 'SKIPPED', reason: 'same-stale-snapshot'
        });
        return { status: 'STALE', dueAt };
    }

    _scheduleBuildInstantWorker(vId, Date.now(), 'window-open', official);
    return { status: 'CHECKING', dueAt: Date.now() };
}

function initInstantFreeForAllVillages() {
    if (typeof getAllVillageIds !== 'function') return;
    if (!_buildInstantEnabled()) {
        getAllVillageIds().forEach(vId => _clearBuildInstantFreeTimeout(vId));
        return;
    }
    getAllVillageIds().forEach(vId => checkAndScheduleBuildInstantFree(vId));
}

/** A known build mutation is a legitimate reason to inspect the new queue once. */
function scheduleBuildInstantReconciliation(villageId, delayMs = 200) {
    const vId = String(villageId || game_data?.village?.id || '');
    if (!vId || !_buildInstantEnabled()) return { status: 'DISABLED' };
    const official = _buildInstantStateApi()?.get(vId)?.official || {};
    _scheduleBuildInstantWorker(vId, Date.now() + Math.max(0, Number(delayMs) || 0), 'known-build-mutation', official, {
        statePatch: { state: 'STALE' }
    });
    return { status: 'RECONCILING' };
}

async function _inspectBuildInstant(villageId, reason) {
    const vId = String(villageId);
    if (vId == String(game_data?.village?.id || '') &&
        document.querySelector('#building_wrapper') && document.querySelector('#buildings') &&
        typeof observeBuildQueueDocument === 'function') {
        return observeBuildQueueDocument(document, vId, 'dom');
    }
    if (typeof fetchVillageMainPage === 'function') {
        const result = await fetchVillageMainPage(vId);
        return typeof observeBuildQueueDocument === 'function'
            ? observeBuildQueueDocument(result.doc, vId, 'build-instant-' + reason)
            : { doc: result.doc };
    }
    const url = (typeof getVillageLinkBase === 'function' ? getVillageLinkBase(vId) : game_data.link_base_pure) + 'main';
    const response = await _buildInstantRequest({
        feature: 'build-instant', villageId: vId, logicalResource: 'village-main:' + vId,
        method: 'GET', reason
    }, () => fetch(url, { credentials: 'include' }));
    _throwBuildInstantResponse(response, url);
    return { doc: new DOMParser().parseFromString(await response.text(), 'text/html') };
}

function _buildInstantButtonData(observed) {
    const fromState = observed?.official?.instantFree;
    if (fromState?.orderId) return fromState;
    const button = observed?.doc?.querySelector?.('.btn-instant-free');
    if (!button) return null;
    const match = (button.getAttribute('onclick') || '').match(/change_order\((\d+)/);
    return {
        orderId: match?.[1] || null,
        availableFrom: (parseInt(button.getAttribute('data-available-from'), 10) || 0) * 1000 || null,
        availableTo: (parseInt(button.getAttribute('data-available-to'), 10) || 0) * 1000 || null
    };
}

async function runBuildInstantFreeWorker(villageId, expectedGeneration, expectedHash, reason, uncertainOrderId) {
    const vId = String(villageId || game_data?.village?.id || '');
    if (!_buildInstantEnabled() || !vId) return { status: 'DISABLED' };
    const state = _buildInstantStateApi();
    let record = state?.get(vId);
    if (!_buildInstantLeaseActive(vId)) return { status: 'LEASE_LOST' };
    if (Number(record?.official?.generation) !== Number(expectedGeneration) ||
        _buildInstantSnapshot(vId, record?.official) !== expectedHash) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'build-instant', villageId: vId, taskKey: 'build-instant:' + vId,
            status: 'SKIPPED', reason: 'stale-snapshot'
        });
        return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
    }

    _setBuildInstantState(vId, { state: 'CHECKING', nextDueAt: null, reason }, true);
    const inspectSnapshot = _buildInstantSnapshot(vId, record?.official);
    const result = await window.PremiumFeaturesAsync.runResilientTask({
        key: 'build-instant:inspect:' + vId,
        feature: 'build-instant', villageId: vId, logicalResource: 'village-main:' + vId,
        method: 'GET',
        url: (typeof getVillageLinkBase === 'function' ? getVillageLinkBase(vId) : game_data.link_base_pure) + 'main',
        snapshotHash: inspectSnapshot,
        run: () => _inspectBuildInstant(vId, reason)
    });
    if (result.status !== 'SUCCESS') {
        if (result.status === 'SOFT_PAUSED') {
            _scheduleBuildInstantWorker(vId, result.retryAt, 'soft-pause', record?.official, {
                statePatch: { state: 'SOFT_PAUSED' }
            });
        }
        return result;
    }

    if (!_buildInstantLeaseActive(vId)) return { status: 'LEASE_LOST' };
    record = state?.get(vId);
    const button = _buildInstantButtonData(result.value);
    if (uncertainOrderId && String(button?.orderId || '') !== String(uncertainOrderId) &&
        !record?.official?.cancelIds?.some(id => String(id) === String(uncertainOrderId))) {
        _setBuildInstantState(vId, { state: 'IDLE', uncertain: null, reason: 'uncertain-confirmed-complete' }, true);
        return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
    }
    if (!button?.orderId) {
        const snapshotHash = _buildInstantSnapshot(vId, record?.official);
        const dueAt = Number(record?.official?.nextSlotAt) > Date.now()
            ? Number(record.official.nextSlotAt) + BUILD_INSTANT_COMPLETION_MARGIN_MS
            : null;
        _setBuildInstantState(vId, {
            state: 'STALE', nextDueAt: dueAt,
            checkedOfficialGeneration: record?.official?.generation || 0,
            snapshotHash, reason: 'button-absent', uncertain: null
        }, true);
        if (dueAt) _scheduleBuildInstantWorker(vId, dueAt, 'known-completion', record.official, {
            checkedOfficialGeneration: record.official.generation,
            statePatch: { state: 'STALE' }
        });
        return { status: 'STALE' };
    }

    const now = Date.now();
    if (button.availableFrom && now < button.availableFrom) {
        _scheduleBuildInstantWorker(vId, button.availableFrom, 'button-window', record.official, {
            orderId: button.orderId,
            statePatch: { state: 'WAITING_WINDOW', orderId: String(button.orderId), availableFrom: button.availableFrom, availableTo: button.availableTo }
        });
        return { status: 'WAITING_WINDOW' };
    }
    if (button.availableTo && now >= button.availableTo) {
        _setBuildInstantState(vId, {
            state: 'STALE', checkedOfficialGeneration: record.official.generation,
            snapshotHash: _buildInstantSnapshot(vId, record.official), reason: 'window-closed'
        }, true);
        return { status: 'STALE' };
    }
    return buildInstantFreeApiCall(button.orderId, vId, record.official.generation, _buildInstantSnapshot(vId, record.official));
}

async function buildInstantFreeApiCall(orderId, villageId, expectedGeneration, expectedHash) {
    const vId = String(villageId || game_data?.village?.id || '');
    const csrf = game_data?.csrf;
    const state = _buildInstantStateApi();
    const record = state?.get(vId);
    if (!vId || !csrf || !_buildInstantLeaseActive(vId)) return { status: 'LEASE_LOST' };
    if (Number(record?.official?.generation) !== Number(expectedGeneration) ||
        _buildInstantSnapshot(vId, record?.official) !== expectedHash ||
        !record?.official?.cancelIds?.some(id => String(id) === String(orderId))) {
        window.PremiumFeaturesDiagnostics?.record?.({
            feature: 'build-instant', villageId: vId, taskKey: 'build-instant:' + vId,
            status: 'SKIPPED', reason: 'mutation-precondition'
        });
        return { status: 'STALE_GENERATION' };
    }

    _setBuildInstantState(vId, { state: 'EXECUTING', orderId: String(orderId), reason: 'free-window' }, true);
    const linkBase = typeof getVillageLinkBase === 'function' ? getVillageLinkBase(vId) : game_data.link_base_pure;
    const url = linkBase + 'main&ajaxaction=build_order_reduce&h=' + csrf + '&id=' + orderId + '&destroy=0';
    const resilient = await window.PremiumFeaturesAsync.runResilientTask({
        key: 'build-instant:mutation:' + vId,
        feature: 'build-instant', villageId: vId, logicalResource: 'build-instant:' + vId,
        method: 'GET', url, mutation: true, leaseKey: 'build-instant:' + vId,
        snapshotHash: expectedHash, scheduler: window.PremiumFeaturesBackgroundScheduler,
        reconcile: function () {
            const latest = state?.get(vId)?.official || {};
            _scheduleBuildInstantWorker(vId, Date.now(), 'uncertain-reconcile', latest, { orderId: String(orderId) });
        },
        run: async function () {
            if (!_buildInstantLeaseActive(vId)) {
                const error = new Error('Build Instant lease lost');
                error.code = 'LEASE_LOST';
                throw error;
            }
            const response = await _buildInstantRequest({
                feature: 'build-instant', villageId: vId, logicalResource: 'build-instant:' + vId,
                method: 'GET', reason: 'instant-free-mutation'
            }, () => fetch(url, {
                method: 'GET',
                headers: { accept: 'application/json, text/javascript, */*; q=0.01', 'tribalwars-ajax': '1', 'x-requested-with': 'XMLHttpRequest' },
                credentials: 'include'
            }));
            _throwBuildInstantResponse(response, url);
            return response.json();
        }
    });

    if (resilient.status === 'UNCERTAIN') {
        _setBuildInstantState(vId, {
            state: 'UNCERTAIN', uncertain: { orderId: String(orderId), snapshotHash: expectedHash, at: Date.now() },
            nextDueAt: resilient.retryAt, reason: 'mutation-uncertain'
        }, true);
        return resilient;
    }
    if (resilient.status === 'SOFT_PAUSED') {
        _scheduleBuildInstantWorker(vId, resilient.retryAt, 'soft-pause', record.official, {
            statePatch: { state: 'SOFT_PAUSED' }
        });
        return resilient;
    }
    if (resilient.status !== 'SUCCESS') return resilient;
    if (!_buildInstantLeaseActive(vId)) return { status: 'LEASE_LOST' };

    const official = state.get(vId).official || {};
    const queue = (official.queue || []).slice();
    const levels = (official.levels || []).slice();
    const slots = (official.slots || []).slice();
    const cancelIds = (official.cancelIds || []).slice();
    let completedIndex = cancelIds.findIndex(id => String(id) === String(orderId));
    if (completedIndex < 0) completedIndex = 0;
    queue.splice(completedIndex, 1); levels.splice(completedIndex, 1);
    slots.splice(completedIndex, 1); cancelIds.splice(completedIndex, 1);
    state.updateOfficial(vId, Object.assign({}, official, {
        queue, levels, slots, cancelIds,
        nextSlotAt: slots[0] || null,
        lastSlotAt: slots.length > 1 ? slots[slots.length - 1] : null,
        full: false, instantFree: null, fetchedAt: Date.now(), source: 'build-instant-response'
    }));
    _setBuildInstantState(vId, { state: 'IDLE', uncertain: null, orderId: null, reason: 'completed' }, true);
    state.publishObservation?.(vId);
    const villageName = typeof getVillageName === 'function' ? getVillageName(vId) : vId;
    showAutoHideBox('[' + villageName + '] ' + t('buildQueue.instantFreeCompleted'), false);
    if (typeof requestBuildQueueReconcile === 'function') {
        requestBuildQueueReconcile(vId, { reason: 'build-instant-completed', delayMs: BUILD_INSTANT_COMPLETION_MARGIN_MS });
    }
    return checkAndScheduleBuildInstantFree(vId, { observeDom: false });
}

// Compatibility wrappers for timeout records persisted by earlier versions.
function fetchAndExecuteBuildInstantFree(_expectedCompletionMs, villageId) {
    const vId = String(villageId || game_data?.village?.id || '');
    const official = _buildInstantStateApi()?.get(vId)?.official || {};
    return runBuildInstantFreeWorker(vId, official.generation, _buildInstantSnapshot(vId, official), 'legacy-check', null);
}

function scheduleVillageInstantFreeCheck(villageId, waitTime) {
    const official = _buildInstantStateApi()?.get(villageId)?.official || {};
    _scheduleBuildInstantWorker(villageId, Date.now() + Math.max(0, Number(waitTime) || 0), 'legacy-schedule', official);
}

function scheduleVillageInstantFreeApiCall(villageId, orderId, waitTime) {
    const official = _buildInstantStateApi()?.get(villageId)?.official || {};
    _scheduleBuildInstantWorker(villageId, Date.now() + Math.max(0, Number(waitTime) || 0), 'legacy-api-schedule', official, { orderId });
}

if (typeof registerTimeoutHandler === 'function') {
    registerTimeoutHandler('instantFreeWorker', runBuildInstantFreeWorker);
    registerTimeoutHandler('instantFreeCheck', fetchAndExecuteBuildInstantFree);
    registerTimeoutHandler('instantFreeApiCall', function (orderId, villageId) {
        const official = _buildInstantStateApi()?.get(villageId)?.official || {};
        return runBuildInstantFreeWorker(villageId, official.generation, _buildInstantSnapshot(villageId, official), 'legacy-api', orderId);
    });
}

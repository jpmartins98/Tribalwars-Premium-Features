// Persistent generation-fenced timeouts plus a low-concurrency cooperative task scheduler.

var activeTimeouts = {};
var activeTimeoutGenerations = {};
var timeoutHandlers = {};

const BACKGROUND_TASK_PRIORITY = Object.freeze({
    MANUAL: 1,
    RECONCILIATION: 2,
    AUTOMATIC: 3,
    REFRESH: 4,
    HOUSEKEEPING: 5
});

function deterministicSpread(key, minimumMs, maximumMs) {
    const low = Math.max(0, Math.floor(Number(minimumMs) || 0));
    const high = Math.max(low, Math.floor(Number(maximumMs) || low));
    if (low === high) return low;
    const text = String(key);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return low + (hash >>> 0) % (high - low + 1);
}

function createCooperativeScheduler(options = {}) {
    const host = options.host || window;
    const clock = options.clock || host;
    const now = options.now || (() => Date.now());
    const runtime = options.runtime || null;
    const coordinator = options.coordinator || null;
    const concurrency = Math.max(1, Number(options.concurrency) || 1);
    const turnGapMs = Math.max(0, Number(options.turnGapMs) || 250);
    const interactionDeferMs = Math.max(50, Number(options.interactionDeferMs) || 500);
    const tasks = new Map();
    const activeTasks = new Map();
    const persistentHandlers = new Map();
    const taskPauses = new Map();
    let sequence = 0;
    let running = 0;
    let wakeTimer = null;
    let nextEligibleAt = 0;
    let paused = false;
    let hardStopped = false;
    let started = false;

    function persistentStorageKey(key) {
        return 'twpf_background_task_v1:' + String(key);
    }

    function persistDescriptor(task) {
        if (!task.persist || !task.handlerName) return;
        const record = {
            key: task.key,
            handlerName: task.handlerName,
            args: task.args || [],
            priority: task.priority,
            dueAt: task.dueAt,
            leaseKey: task.leaseKey,
            requiresCoordinator: task.requiresCoordinator,
            interactionScope: task.interactionScope,
            generation: task.generation
        };
        const writer = host.PremiumFeaturesWriteBehind;
        if (writer) writer.set(persistentStorageKey(task.key), JSON.stringify(record));
        else host.localStorage?.setItem(persistentStorageKey(task.key), JSON.stringify(record));
    }

    function removePersistedDescriptor(key) {
        const writer = host.PremiumFeaturesWriteBehind;
        if (writer) writer.remove(persistentStorageKey(key));
        else host.localStorage?.removeItem(persistentStorageKey(key));
    }

    function createTask(descriptor) {
        let resolvePromise;
        const promise = new Promise(resolve => { resolvePromise = resolve; });
        const handlerName = descriptor.handlerName;
        const handler = handlerName ? persistentHandlers.get(handlerName) : null;
        return {
            key: String(descriptor.key),
            run: descriptor.run || (handler ? guard => handler(descriptor.args || [], guard) : null),
            handlerName,
            args: descriptor.args || [],
            priority: Math.min(5, Math.max(1, Number(descriptor.priority) || BACKGROUND_TASK_PRIORITY.REFRESH)),
            dueAt: Number(descriptor.dueAt) || now(),
            leaseKey: descriptor.leaseKey || null,
            leaseTtlMs: Number(descriptor.leaseTtlMs) || 30000,
            requiresCoordinator: !!descriptor.requiresCoordinator,
            interactionScope: descriptor.interactionScope || null,
            snapshotHash: descriptor.snapshotHash || null,
            persist: !!descriptor.persist,
            generation: Number(descriptor.generation) || 1,
            sequence: sequence++,
            promise,
            resolve: resolvePromise
        };
    }

    function enqueue(descriptor) {
        if (!descriptor || !descriptor.key) throw new Error('Background task requires a key');
        const key = String(descriptor.key);
        const active = activeTasks.get(key);
        if (active && !descriptor.rerunWhileActive) return active.promise;
        const existing = tasks.get(key);
        if (existing) {
            existing.run = descriptor.run || existing.run;
            existing.handlerName = descriptor.handlerName || existing.handlerName;
            existing.args = descriptor.args || existing.args;
            existing.priority = Math.min(existing.priority, Number(descriptor.priority) || existing.priority);
            existing.dueAt = Math.min(existing.dueAt, Number(descriptor.dueAt) || now());
            existing.leaseKey = descriptor.leaseKey || existing.leaseKey;
            existing.requiresCoordinator = descriptor.requiresCoordinator ?? existing.requiresCoordinator;
            existing.interactionScope = descriptor.interactionScope || existing.interactionScope;
            existing.snapshotHash = descriptor.snapshotHash || existing.snapshotHash;
            existing.persist = descriptor.persist ?? existing.persist;
            existing.generation = Math.max(existing.generation + 1, Number(descriptor.generation) || 0);
            if (!existing.run && existing.handlerName && persistentHandlers.has(existing.handlerName)) {
                existing.run = guard => persistentHandlers.get(existing.handlerName)(existing.args || [], guard);
            }
            persistDescriptor(existing);
            scheduleWake();
            return existing.promise;
        }
        const task = createTask(descriptor);
        if (typeof task.run !== 'function') {
            task.resolve({ status: 'MISSING_HANDLER', key });
            return task.promise;
        }
        tasks.set(key, task);
        persistDescriptor(task);
        scheduleWake();
        return task.promise;
    }

    function cancel(key, reason = 'cancelled') {
        const task = tasks.get(String(key));
        if (!task) return false;
        tasks.delete(String(key));
        removePersistedDescriptor(String(key));
        task.resolve({ status: 'CANCELLED', reason, key: String(key) });
        scheduleWake();
        return true;
    }

    function sortedEligibleTasks(timestamp) {
        return Array.from(tasks.values())
            .filter(task => task.dueAt <= timestamp && (taskPauses.get(task.key) || 0) <= timestamp)
            .sort((first, second) => first.priority - second.priority || first.dueAt - second.dueAt ||
                first.sequence - second.sequence || first.key.localeCompare(second.key));
    }

    function clearWake() {
        if (wakeTimer === null) return;
        clock.clearTimeout(wakeTimer);
        wakeTimer = null;
    }

    function scheduleWake() {
        clearWake();
        if (paused || hardStopped || running >= concurrency || tasks.size === 0) return;
        const timestamp = now();
        const earliestDue = Math.min(...Array.from(tasks.values()).map(task => Math.max(
            task.dueAt,
            taskPauses.get(task.key) || 0,
            nextEligibleAt
        )));
        wakeTimer = clock.setTimeout(function () {
            wakeTimer = null;
            pump();
        }, Math.max(0, earliestDue - timestamp));
    }

    function rescheduleAfterLeaseContention(task, error) {
        const leaseExpiry = Number(error?.currentLease?.expiresAt) || now();
        task.dueAt = Math.max(now() + turnGapMs, leaseExpiry + deterministicSpread(task.key, 25, 250));
        tasks.set(task.key, task);
        persistDescriptor(task);
    }

    async function execute(task) {
        tasks.delete(task.key);
        activeTasks.set(task.key, task);
        const capturedGeneration = task.generation;
        try {
            let value;
            const invoke = async function (guard) {
                if (task.generation !== capturedGeneration) return { status: 'STALE_GENERATION' };
                guard?.assertActive?.();
                return task.run(guard || { assertActive: function () { return true; }, isActive: function () { return true; } });
            };
            if (task.requiresCoordinator && coordinator && !coordinator.isCoordinator()) {
                const error = new Error('Coordinator unavailable');
                error.code = 'LEASE_UNAVAILABLE';
                error.currentLease = coordinator.readLease('coordinator');
                throw error;
            }
            if (task.leaseKey && coordinator) value = await coordinator.runWithLease(task.leaseKey, invoke, { ttlMs: task.leaseTtlMs });
            else value = await invoke(null);

            activeTasks.delete(task.key);
            if (tasks.has(task.key)) persistDescriptor(tasks.get(task.key));
            else removePersistedDescriptor(task.key);
            task.resolve({ status: 'COMPLETED', key: task.key, value });
        } catch (error) {
            if (error?.code === 'LEASE_UNAVAILABLE' || error?.code === 'LEASE_LOST') {
                activeTasks.delete(task.key);
                if (tasks.has(task.key) && tasks.get(task.key) !== task) {
                    persistDescriptor(tasks.get(task.key));
                    task.resolve({ status: 'SUPERSEDED', key: task.key });
                } else {
                    rescheduleAfterLeaseContention(task, error);
                }
            } else {
                activeTasks.delete(task.key);
                if (tasks.has(task.key)) persistDescriptor(tasks.get(task.key));
                else removePersistedDescriptor(task.key);
                task.resolve({ status: 'FAILED', key: task.key, error });
                console.error('[TW Scheduler] Task failed:', task.key, error);
            }
        } finally {
            running--;
            nextEligibleAt = Math.max(nextEligibleAt, now() + turnGapMs);
            scheduleWake();
        }
    }

    function pump() {
        if (paused || hardStopped) return;
        const timestamp = now();
        if (timestamp < nextEligibleAt) {
            scheduleWake();
            return;
        }
        while (running < concurrency) {
            const candidates = sortedEligibleTasks(timestamp);
            if (!candidates.length) break;
            let task = candidates[0];
            if (task.interactionScope && runtime?.isInteractionActive?.(task.interactionScope)) {
                task.dueAt = timestamp + interactionDeferMs;
                persistDescriptor(task);
                const alternative = candidates.find(candidate => candidate !== task &&
                    (!candidate.interactionScope || !runtime?.isInteractionActive?.(candidate.interactionScope)));
                if (!alternative) break;
                task = alternative;
            }
            running++;
            execute(task);
            if (turnGapMs > 0) break;
        }
        scheduleWake();
    }

    function pause() {
        paused = true;
        clearWake();
    }

    function resume() {
        if (hardStopped) return;
        paused = false;
        scheduleWake();
    }

    function pauseTask(key, untilMs) {
        taskPauses.set(String(key), Math.max(now(), Number(untilMs) || now()));
        scheduleWake();
    }

    function hardStop(reason) {
        hardStopped = true;
        paused = true;
        clearWake();
        return reason;
    }

    function registerHandler(name, handler) {
        persistentHandlers.set(String(name), handler);
        if (started) restorePersistedTasks();
    }

    function restorePersistedTasks() {
        if (!host.localStorage) return;
        Object.keys(host.localStorage).filter(key => key.startsWith('twpf_background_task_v1:')).forEach(storageKey => {
            try {
                const record = JSON.parse(host.localStorage.getItem(storageKey));
                if (!record?.key || !persistentHandlers.has(record.handlerName)) return;
                enqueue(Object.assign({}, record, {
                    persist: true,
                    run: guard => persistentHandlers.get(record.handlerName)(record.args || [], guard)
                }));
            } catch (error) {
                console.warn('[TW Scheduler] Invalid persisted task:', storageKey, error);
            }
        });
    }

    function start() {
        if (started) return;
        started = true;
        if (runtime) {
            runtime.addEventListener('scheduler:visibility', host.document, 'visibilitychange', function () {
                if (host.document.hidden) pause();
                else resume();
            });
            runtime.addEventListener('scheduler:pageshow', host, 'pageshow', resume);
            runtime.addEventListener('scheduler:online', host, 'online', resume);
        }
        restorePersistedTasks();
        scheduleWake();
    }

    function stats() {
        return { started, queued: tasks.size, running, paused, hardStopped, wakeTimerActive: wakeTimer !== null };
    }

    const api = {
        PRIORITY: BACKGROUND_TASK_PRIORITY,
        enqueue,
        cancel,
        pump,
        pause,
        resume,
        pauseTask,
        hardStop,
        registerHandler,
        restorePersistedTasks,
        start,
        stats
    };
    if (options.autoStart !== false) start();
    return api;
}

window.createCooperativeScheduler = createCooperativeScheduler;
var BackgroundScheduler = window.PremiumFeaturesBackgroundScheduler || createCooperativeScheduler({
    runtime: window.PremiumFeaturesRuntimeRegistry,
    coordinator: window.PremiumFeaturesCoordination
});
window.PremiumFeaturesBackgroundScheduler = BackgroundScheduler;

function registerTimeoutHandler(name, fn) {
    timeoutHandlers[name] = fn;
}

function timeoutGenerationKey(id) {
    return 'timeoutGeneration_' + id;
}

function getPersistedTimeoutGeneration(id) {
    return Number(localStorage.getItem(timeoutGenerationKey(id))) || 0;
}

function nextPersistedTimeoutGeneration(id) {
    const generation = getPersistedTimeoutGeneration(id) + 1;
    localStorage.setItem(timeoutGenerationKey(id), String(generation));
    return generation;
}

function isCurrentPersistedTimeout(id, generation, endTime) {
    return getPersistedTimeoutGeneration(id) === generation &&
        Number(localStorage.getItem('endTime_' + id)) === Number(endTime);
}

function clearActiveTimeout(id, generation) {
    if (generation !== undefined && activeTimeoutGenerations[id] !== generation) return;
    if (activeTimeouts[id] !== undefined) clearTimeout(activeTimeouts[id]);
    delete activeTimeouts[id];
    delete activeTimeoutGenerations[id];
}

function clearPersistedTimeout(id) {
    nextPersistedTimeoutGeneration(id);
    clearActiveTimeout(id);
    localStorage.removeItem('endTime_' + id);
    localStorage.removeItem('function_' + id);
    localStorage.removeItem('handler_' + id);
    BackgroundScheduler?.cancel?.('persistent-timeout:' + id, 'persistent timeout cleared');
}

function getPersistentTaskPolicy(id, args) {
    let match = String(id).match(/^building_queue_(\d+)/);
    if (match) return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'build-queue:' + match[1] };
    match = String(id).match(/^build_instant_free_(\d+)/);
    if (match) return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'build-instant:' + match[1] };
    if (id === 'auto_trainer_paladin') return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'paladin' };
    if (id === 'daily_bonus') return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'daily-bonus' };
    if (String(id).startsWith('scavenging')) {
        const villageId = args?.[0] || window.game_data?.village?.id || 'unknown';
        return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: true, leaseKey: 'scavenging:' + villageId };
    }
    return { priority: BACKGROUND_TASK_PRIORITY.AUTOMATIC, requiresCoordinator: false, leaseKey: null };
}

function consumeAndRunPersistedTimeout(id, generation, endTime) {
    if (!isCurrentPersistedTimeout(id, generation, endTime)) return { status: 'STALE_GENERATION' };
    const handlerRaw = localStorage.getItem('handler_' + id);
    const functionRaw = localStorage.getItem('function_' + id);

    // Final generation check is deliberately adjacent to consuming the record and real work.
    if (!isCurrentPersistedTimeout(id, generation, endTime)) return { status: 'STALE_GENERATION' };
    localStorage.removeItem('endTime_' + id);
    localStorage.removeItem('handler_' + id);
    localStorage.removeItem('function_' + id);
    clearActiveTimeout(id, generation);

    if (handlerRaw) {
        const parsed = JSON.parse(handlerRaw);
        const handler = timeoutHandlers[parsed.handlerName];
        if (!handler) throw new Error('No timeout handler registered for "' + parsed.handlerName + '"');
        return handler(...(parsed.args || []));
    }
    if (!functionRaw) return { status: 'MISSING_CALLBACK' };
    return eval('(' + functionRaw + ')();');
}

function dispatchPersistedTimeout(id, generation, endTime) {
    if (!isCurrentPersistedTimeout(id, generation, endTime)) return;
    const handlerRaw = localStorage.getItem('handler_' + id);
    let args = [];
    try { args = handlerRaw ? (JSON.parse(handlerRaw).args || []) : []; } catch (_error) { /* handled at execution */ }
    const policy = getPersistentTaskPolicy(id, args);
    BackgroundScheduler.enqueue({
        key: 'persistent-timeout:' + id,
        priority: policy.priority,
        requiresCoordinator: policy.requiresCoordinator,
        leaseKey: policy.leaseKey,
        generation,
        run: function (guard) {
            if (!isCurrentPersistedTimeout(id, generation, endTime)) return { status: 'STALE_GENERATION' };
            guard?.assertActive?.();
            return consumeAndRunPersistedTimeout(id, generation, endTime);
        },
        rerunWhileActive: true
    });
}

function armPersistedTimeout(id, generation, endTime) {
    clearActiveTimeout(id);
    const delayMs = Math.max(0, Number(endTime) - Date.now());
    activeTimeoutGenerations[id] = generation;
    const timer = setTimeout(function () {
        if (activeTimeoutGenerations[id] !== generation) return;
        dispatchPersistedTimeout(id, generation, endTime);
    }, delayMs);
    activeTimeouts[id] = timer;
    return timer;
}

function persistAndArmTimeout(id, payloadKey, payloadValue, timeToRun, spreadMinMs, spreadMaxMs) {
    clearActiveTimeout(id);
    const spreadMs = deterministicSpread(id, spreadMinMs, spreadMaxMs);
    const delayMs = Math.max(0, Math.floor(Number(timeToRun) || 0) + spreadMs);
    const endTime = Date.now() + delayMs;
    const generation = nextPersistedTimeoutGeneration(id);
    const otherPayloadKey = payloadKey === 'handler_' ? 'function_' : 'handler_';
    localStorage.removeItem(otherPayloadKey + id);
    localStorage.setItem(payloadKey + id, payloadValue);
    localStorage.setItem('endTime_' + id, String(endTime));
    armPersistedTimeout(id, generation, endTime);
    return { id, generation, endTime, delayMs };
}

/**
 * Schedules a reload-surviving callback. Optional spread is deterministic per id; by default the
 * requested due time is exact and the cooperative queue handles simultaneous work.
 */
function setFunctionOnTimeOut(id, func, timeToRun, spreadMinMs = 0, spreadMaxMs = 0) {
    return persistAndArmTimeout(id, 'function_', func.toString(), timeToRun, spreadMinMs, spreadMaxMs);
}

/** Schedules a named, reload-surviving callback with JSON-serialisable arguments. */
function setHandlerOnTimeOut(id, handlerName, args, timeToRun, spreadMinMs = 0, spreadMaxMs = 0) {
    return persistAndArmTimeout(
        id,
        'handler_',
        JSON.stringify({ handlerName, args: Array.isArray(args) ? args : [] }),
        timeToRun,
        spreadMinMs,
        spreadMaxMs
    );
}

function restoreTimeoutById(id) {
    const endTime = Number(localStorage.getItem('endTime_' + id));
    if (!Number.isFinite(endTime) || (!localStorage.getItem('handler_' + id) && !localStorage.getItem('function_' + id))) {
        clearActiveTimeout(id);
        return false;
    }
    let generation = getPersistedTimeoutGeneration(id);
    if (!generation) {
        generation = nextPersistedTimeoutGeneration(id);
    }
    armPersistedTimeout(id, generation, endTime);
    return true;
}

/** Restores every persisted timeout idempotently and registers each timer in activeTimeouts. */
function restoreTimeouts() {
    Object.keys(localStorage)
        .filter(key => key.startsWith('endTime_'))
        .map(key => key.slice('endTime_'.length))
        .forEach(id => restoreTimeoutById(id));
}

function handlePersistedTimeoutStorageEvent(event) {
    if (!event.key) return;
    if (event.key.startsWith('endTime_')) {
        const id = event.key.slice('endTime_'.length);
        if (event.newValue === null) {
            clearActiveTimeout(id);
            BackgroundScheduler.cancel('persistent-timeout:' + id, 'completed in another tab');
        }
        else restoreTimeoutById(id);
    } else if (event.key.startsWith('timeoutGeneration_')) {
        const id = event.key.slice('timeoutGeneration_'.length);
        if (activeTimeoutGenerations[id] !== Number(event.newValue)) {
            clearActiveTimeout(id);
            restoreTimeoutById(id);
        }
    }
}

if (window.PremiumFeaturesRuntimeRegistry) {
    window.PremiumFeaturesRuntimeRegistry.addEventListener(
        'persistent-timeouts:storage', window, 'storage', handlePersistedTimeoutStorageEvent
    );
}

// AutoFarm Adaptive v2.0.15 — native TWPF lifecycle/controller.
(function (root) {
    'use strict';

    const FEATURE = 'autofarm-adaptive';
    const VERSION = '2.0.15';
    const HANDLER = 'autofarm-adaptive-v2.0.15';
    const TASK_PREFIX = 'autofarm-adaptive:';
    const MAP_TTL_MS = 90000;
    const ASSISTANT_TTL_MS = 120000;
    const CAPACITY_TTL_MS = 90000;
    const REPORT_RETRY_MS = 5 * 60000;
    const runtime = {
        storage: null,
        registered: false,
        records: new Map(),
        diagnostics: new Map(),
        diagnosticSeq: 0
    };

    function core() {
        const value = root.PremiumFeaturesAutoFarmAdaptiveCore;
        if (!value) throw coded('AUTOFARM_CORE_MISSING', 'AutoFarm compatibility core is unavailable');
        return value;
    }

    function scheduler() { return root.PremiumFeaturesBackgroundScheduler; }
    function coordinator() { return root.PremiumFeaturesCoordination; }
    function coded(code, message) { const error = new Error(message || code); error.code = code; return error; }
    function now() { return Date.now(); }
    function scopeKey(scope) { return `${scope.world}:p${scope.playerId}:v${scope.sourceVillageId}`; }
    function taskKey(scope) { return TASK_PREFIX + scopeKey(scope); }
    function leaseKey(scope) { return 'autofarm:' + scopeKey(scope); }

    function currentScope(sourceVillageId) {
        const world = String(root.location?.host || '');
        const playerId = String(root.game_data?.player?.id || '');
        const villageId = String(sourceVillageId || root.game_data?.village?.id || '');
        if (!world || !playerId || !villageId) throw coded('AUTOFARM_SCOPE_MISSING', 'Current account/village is unavailable');
        return { world, playerId, sourceVillageId: villageId };
    }

    function featureAllowed() {
        const value = root.settings_cookies?.general?.show__auto_farm_adaptive;
        return value === undefined ? false : (typeof value === 'object' ? value.enabled === true : value === true);
    }

    function hardStopped() {
        return Boolean(scheduler()?.stats?.().hardStopped || root.PremiumFeaturesBotProtection?.isActive?.());
    }

    function assertNetworkAllowed(guard) {
        guard?.assertActive?.();
        if (hardStopped()) throw coded('HARD_STOP', 'TWPF HARD_STOP is active');
    }

    function assertActiveVillage(scope) {
        if (String(root.game_data?.village?.id || '') !== String(scope.sourceVillageId)) {
            throw coded('AUTOFARM_VILLAGE_CHANGED', 'Active village changed before the mutation boundary');
        }
    }

    function diagnostic(scope, status, reason, extra = {}) {
        const entry = { at: now(), feature: FEATURE, villageId: scope.sourceVillageId, status, reason, ...extra };
        const key = scopeKey(scope);
        const list = runtime.diagnostics.get(key) || [];
        list.push(entry);
        if (list.length > 120) list.splice(0, list.length - 120);
        runtime.diagnostics.set(key, list);
        root.PremiumFeaturesDiagnostics?.record?.(entry);
        try {
            const eventId = `${scopeKey(scope)}:${entry.at}:${status}:${coordinator()?.instanceId || 'tab'}:${++runtime.diagnosticSeq}`;
            Promise.resolve(storage().appendDiagnostic(scope, {
                ...scope, eventId, at: entry.at, kind: String(status), value: entry
            })).catch(error => console.warn('[TWPF AutoFarm] diagnostic persistence failed', error));
        } catch (_) {}
        render(scope);
        return entry;
    }

    function parseHtml(text) {
        return new DOMParser().parseFromString(String(text || ''), 'text/html');
    }

    function containsProtection(text, doc) {
        return /bot protection|captcha|prote[cç][aã]o contra bots/i.test(String(text || '')) || Boolean(
            doc?.querySelector?.('td.bot-protection-row, #botprotection_quest, .captcha')
        );
    }

    function containsLogin(text, responseUrl) {
        return /name=["']login["']/i.test(String(text || '')) || /screen=login/i.test(String(responseUrl || ''));
    }

    async function rawRequest(scope, url, options, guard) {
        assertNetworkAllowed(guard);
        const timeoutMs = Math.max(5000, Number(options.timeoutMs) || 20000);
        const controller = new AbortController();
        const timer = root.setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await root.fetch(url, {
                credentials: 'include', cache: 'no-store', ...options, signal: controller.signal
            });
        } finally {
            root.clearTimeout(timer);
        }
        const text = await response.text();
        const doc = /html/i.test(response.headers?.get?.('content-type') || '') || /<html|<body|<table/i.test(text)
            ? parseHtml(text)
            : null;
        if (containsProtection(text, doc)) {
            root.PremiumFeaturesBackgroundScheduler?.hardStop?.({ source: 'bot-protection', feature: FEATURE });
            root.PremiumFeaturesCoordination?.broadcast?.('hard-stop', { source: 'bot-protection', feature: FEATURE });
            root.PremiumFeaturesBotProtection?.suspendForHardStop?.();
            throw coded('HARD_STOP', 'Bot Protection/CAPTCHA detected');
        }
        if (containsLogin(text, response.url)) throw coded('HARD_STOP', 'Session expired');
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            error.url = response.url || url;
            throw error;
        }
        guard?.assertActive?.();
        return { response, text, doc };
    }

    async function resilientRequest(scope, key, url, options, guard, mutation = false) {
        const asyncApi = root.PremiumFeaturesAsync;
        if (!asyncApi?.runResilientTask) return rawRequest(scope, url, options, guard);
        const result = await asyncApi.runResilientTask({
            key: `${FEATURE}:${scopeKey(scope)}:${key}`,
            feature: FEATURE,
            villageId: scope.sourceVillageId,
            logicalResource: key,
            url,
            method: options.method || 'GET',
            mutation,
            leaseKey: leaseKey(scope),
            run: () => rawRequest(scope, url, options, guard)
        });
        if (result.status === asyncApi.TASK_RESULT.SUCCESS) return result.value;
        const error = result.failure?.error || coded(`AUTOFARM_${result.status}`, result.status);
        error.taskResult = result;
        throw error;
    }

    function villageCoord() {
        const village = root.game_data?.village || {};
        if (/^\d{3}\|\d{3}$/.test(String(village.coord || ''))) return String(village.coord);
        if (Number.isFinite(Number(village.x)) && Number.isFinite(Number(village.y))) return `${village.x}|${village.y}`;
        return null;
    }

    function distance(coord, center = villageCoord()) {
        const a = String(coord || '').match(/^(\d{3})\|(\d{3})$/);
        const b = String(center || '').match(/^(\d{3})\|(\d{3})$/);
        return a && b ? Math.hypot(Number(a[1]) - Number(b[1]), Number(a[2]) - Number(b[2])) : Infinity;
    }

    function parseWorldMap(text, radius, center = villageCoord()) {
        const targets = new Map();
        const c = String(center || '').match(/^(\d{3})\|(\d{3})$/);
        if (!c) throw coded('AUTOFARM_CENTER_UNKNOWN', 'Current village coordinates are unavailable');
        const cx = Number(c[1]);
        const cy = Number(c[2]);
        for (const line of String(text || '').split('\n')) {
            if (!line) continue;
            const fields = line.split(',');
            if (fields.length < 5 || String(fields[4]) !== '0') continue;
            const x = Number(fields[2]);
            const y = Number(fields[3]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x - cx, y - cy) > radius) continue;
            targets.set(`${String(x).padStart(3, '0')}|${String(y).padStart(3, '0')}`, String(fields[0]));
        }
        return targets;
    }

    function farmUrl(scope, page = 0) {
        const url = new URL('/game.php', root.location.origin);
        url.searchParams.set('village', scope.sourceVillageId);
        url.searchParams.set('screen', 'am_farm');
        url.searchParams.set('order', 'distance');
        url.searchParams.set('dir', 'asc');
        url.searchParams.set('Farm_page', String(page));
        return url.toString();
    }

    async function readMap(scope, settings, guard) {
        const url = new URL('/map/village.txt', root.location.origin).toString();
        const read = await resilientRequest(scope, 'map', url, { method: 'GET', cache: 'no-cache' }, guard);
        const targets = parseWorldMap(read.text, settings.radius);
        const observedAt = now();
        return {
            targets,
            proof: {
                status: 'READY', observedAt, freshUntil: observedAt + MAP_TTL_MS,
                authorizationFreshUntil: observedAt + MAP_TTL_MS,
                revision: observedAt, targetIds: Object.fromEntries(targets), center: villageCoord()
            }
        };
    }

    async function readAssistant(scope, settings, targets, guard) {
        const wanted = new Set(targets.keys());
        const rows = new Map();
        let firstDoc = null;
        let pagesRead = 0;
        let coveredRadius = 0;
        let pageCount = 1;
        for (let page = 0; page < Math.max(1, settings.scanMaxPages); page++) {
            const read = await resilientRequest(scope, `assistant:${page}`, farmUrl(scope, page), {
                method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }, guard);
            const doc = read.doc || parseHtml(read.text);
            if (!firstDoc) {
                firstDoc = doc;
                pageCount = Math.min(core().maxFarmPages(doc), Math.max(1, settings.scanMaxPages));
            }
            for (const [coord, row] of core().parseFarmRows(doc, wanted, settings.farmTemplate)) rows.set(coord, row);
            coveredRadius = Math.max(coveredRadius, Number(core().assistantPageCoverageRadius(doc)) || 0);
            pagesRead++;
            if (page + 1 >= pageCount || coveredRadius >= settings.radius) break;
        }
        const observedAt = now();
        return {
            rows, firstDoc, pagesRead, coveredRadius,
            coversRadius: coveredRadius >= settings.radius || pagesRead >= pageCount,
            proof: { status: 'READY', observedAt, freshUntil: observedAt + ASSISTANT_TTL_MS, revision: observedAt }
        };
    }

    function chooseTemplateAndCapacity(assistant, settings, sourceVillageId) {
        const supportedRows = [...assistant.rows.values()].filter(row => row.buttonSupported && row.templateId);
        const templateIds = new Set(supportedRows.map(row => String(row.templateId)));
        // When every target in the radius is new, the filtered row map is empty.
        // A fresh page can still identify the selected A/B template unambiguously.
        const letter = String(settings.farmTemplate || 'A').toLowerCase();
        for (const anchor of assistant.firstDoc?.querySelectorAll?.(`#plunder_list a.farm_icon_${letter}`) || []) {
            const parsed = core().parseFarmButton(anchor.closest?.('tr'), settings.farmTemplate);
            if (parsed?.supported && parsed.templateId) templateIds.add(String(parsed.templateId));
        }
        const observedTemplateIds = [...templateIds];
        if (observedTemplateIds.length !== 1) return { usable: false, reason: 'TEMPLATE_AMBIGUOUS' };
        const templateId = observedTemplateIds[0];
        const inline = core().parseInlineTemplateComposition(assistant.firstDoc, templateId);
        const dom = core().parseDomTemplateComposition(assistant.firstDoc, templateId);
        if (inline && dom && !core().sameComposition(inline, dom)) return { usable: false, reason: 'TEMPLATE_CONFLICT' };
        const composition = core().normalizeComposition(inline || dom);
        const currentUnits = core().parseInlineCurrentUnits(assistant.firstDoc) || core().parseUnitsEntryAll(assistant.firstDoc);
        const capacity = composition && currentUnits ? core().capacityForComposition(composition, currentUnits) : null;
        if (!composition || !currentUnits || !Number.isFinite(capacity)) {
            return { usable: false, reason: 'CAPACITY_UNKNOWN', templateId, composition, currentUnits };
        }
        const observedAt = now();
        return {
            usable: true, templateId, composition, currentUnits, capacity,
            proof: core().normalizeCapacityProof({
                value: capacity, exact: true, authoritative: true,
                observedAt, freshUntil: observedAt + CAPACITY_TTL_MS,
                source: 'ASSISTANT_CURRENT_UNITS', templateId,
                farmTemplate: settings.farmTemplate, composition,
                compositionAuthoritative: true, currentUnits, sourceVillageId
            })
        };
    }

    function storage() {
        if (!runtime.storage) {
            const factory = root.PremiumFeaturesAutoFarmStorage;
            if (!factory?.create) throw coded('AUTOFARM_STORAGE_MISSING', 'Native AutoFarm storage is unavailable');
            runtime.storage = factory.create({ host: root, coordination: coordinator() });
        }
        return runtime.storage;
    }

    function assertLegacyStandaloneInactive(scope) {
        const factory = root.PremiumFeaturesAutoFarmStorage;
        if (typeof factory?.readLegacySnapshot !== 'function') return true;
        factory.readLegacySnapshot(scope, { host: root, storage: root.localStorage, now });
        return true;
    }

    function metaKey(scope, type) {
        return [scope.world, scope.playerId, scope.sourceVillageId, type];
    }

    async function ensureNativeRecords(scope) {
        let settings = await storage().readRecord('autofarm_meta', metaKey(scope, 'settings'));
        if (!settings) {
            try {
                const captured = await storage().migrateLegacySnapshot(scope);
                if (captured.status !== 'NO_LEGACY_DATA') {
                    const imported = await storage().materializeLegacySnapshot(scope);
                    if (imported?.marker?.accountHardStopActive || imported?.snapshot?.accountHardStopActive) {
                        triggerHardStop(coded('HARD_STOP', 'Imported standalone account hard-stop'));
                    }
                }
            } catch (error) {
                if (!['AUTOFARM_LEGACY_ACTIVE', 'AUTOFARM_LEGACY_CORRUPT'].includes(error?.code)) throw error;
                diagnostic(scope, 'MIGRATION_BLOCKED', error.code);
            }
            settings = await storage().readRecord('autofarm_meta', metaKey(scope, 'settings'));
        }
        if (!settings) {
            settings = await storage().putMetaCas(scope, 'settings', 0,
                core().normalizeCfg({ ...core().DEFAULTS, enabled: false }));
        }
        let coordinationRecord = await storage().readRecord('autofarm_meta', metaKey(scope, 'coordination'));
        if (!coordinationRecord) {
            coordinationRecord = await storage().putMetaCas(scope, 'coordination', 0,
                core().normalizeCoordinationState({ state: 'DISABLED', reason: 'native-default' }));
        }
        let targetRecord = await storage().readRecord('autofarm_operational', metaKey(scope, 'targetStates'));
        if (!targetRecord) {
            await storage().putRecords('autofarm_operational', [{
                ...scope, recordType: 'targetStates', revision: 1, updatedAt: now(), value: {}
            }]);
            targetRecord = await storage().readRecord('autofarm_operational', metaKey(scope, 'targetStates'));
        }
        const records = { settings, coordination: coordinationRecord, targets: targetRecord };
        runtime.records.set(scopeKey(scope), records);
        return records;
    }

    async function loadModel(scope) {
        const key = [scope.world, scope.playerId, scope.sourceVillageId];
        const [farms, dispatches, reports, events] = await Promise.all([
            storage().readIndex('autofarm_farms', 'by_village', key),
            storage().readIndex('autofarm_dispatches', 'by_village', key),
            storage().readIndex('autofarm_reports', 'by_village', key),
            storage().readIndex('autofarm_events', 'by_village', key)
        ]);
        const modelMeta = await storage().readRecord('autofarm_meta', metaKey(scope, 'modelMeta'));
        return {
            ...(modelMeta?.value || {}),
            _metaRecord: modelMeta,
            farms: Object.fromEntries(farms.map(record => [record.targetCoord, record.value || record])),
            dispatches,
            reportLedger: reports,
            events,
            sectors: modelMeta?.value?.sectors || {},
            createdAt: Number(modelMeta?.value?.createdAt) || now(),
            updatedAt: Number(modelMeta?.value?.updatedAt) || 0
        };
    }

    function targetStateBlocked(state, timestamp = now()) {
        return Boolean(state?.pending || state?.sending || state?.uncertain || Number(state?.cooldownUntil || 0) > timestamp);
    }

    function historicalEvidence(coord, model, state) {
        if (state?.assistantEverSeen || state?.lastReportId || state?.pending || state?.sending || Number(state?.sentAt || 0) > 0) return true;
        if (model.farms?.[coord]?.observationCount > 0 || model.farms?.[coord]?.lastReportId) return true;
        if (model.dispatches?.some(item => item.targetCoord === coord || item.coord === coord)) return true;
        if (model.reportLedger?.some(item => item.targetCoord === coord || item.coord === coord)) return true;
        if (core().normalizedCoordList(model.reportIndex?.historyCoords).includes(coord)) return true;
        return model.events?.some(item => item.targetCoord === coord || item.coord === coord);
    }

    function makeCandidate(coord, targetId, row, model, settings, timestamp, bootstrap = false) {
        const farm = core().normalizeAdaptiveFarm(model.farms?.[coord], coord, distance(coord));
        const due = !model.farms?.[coord] || core().adaptiveFarmDue(farm, timestamp, settings);
        return {
            coord, targetId: String(targetId), templateId: row?.templateId || null,
            reportId: row?.reportId || null, distance: distance(coord), bootstrap,
            due, farm, reason: bootstrap ? 'BOOTSTRAP_NEW' : (due ? 'DUE' : 'EARLY')
        };
    }

    function resultFromAssistantRow(row, settings, timestamp) {
        const dot = String(row?.dot || 'unknown');
        if (['red', 'red_blue', 'red_yellow'].includes(dot)) {
            return { kind: 'loss', cooldownUntil: timestamp + settings.lossCooldownMin * 60000 };
        }
        if (row?.haul === 'full') {
            return { kind: 'full', cooldownUntil: timestamp + settings.fullCooldownMin * 60000 };
        }
        if (row?.haul === 'partial') {
            return { kind: 'clean', cooldownUntil: timestamp + settings.cleanCooldownMin * 60000 };
        }
        return { kind: 'unknown', cooldownUntil: timestamp + settings.unknownCooldownMin * 60000 };
    }

    async function synchronizePendingAssistantReports(scope, settings, records, assistant, guard) {
        const targetStates = records.targets?.value || {};
        let changed = 0;
        for (const [coord, state] of Object.entries(targetStates)) {
            if (!state?.pending || !state.pendingMutationId) continue;
            const row = assistant.rows.get(coord);
            if (!reportIsSafelyNewer(row, {
                reportIdAtSend: state.reportIdAtSend,
                transmittedAt: state.sentAt
            })) continue;
            const result = resultFromAssistantRow(row, settings, now());
            const outcome = await storage().confirmPendingReport(scope, {
                targetCoord: coord,
                reportId: row.reportId,
                observedAt: row.assistantAttackAt,
                dispatchId: state.pendingMutationId,
                resultKind: result.kind,
                cooldownUntil: result.cooldownUntil,
                haul: row.haul,
                dot: row.dot
            }, guard);
            if (outcome?.status === 'MATCHED') {
                changed++;
                diagnostic(scope, 'REPORT_MATCHED', coord, {
                    reportId: row.reportId, dispatchId: state.pendingMutationId,
                    evidence: 'assistant-summary'
                });
            }
        }
        if (changed) {
            records.targets = await storage().readRecord('autofarm_operational', metaKey(scope, 'targetStates'));
        }
        return changed;
    }

    function reportDetailUrl(scope, reportId) {
        const url = new URL('/game.php', root.location.origin);
        url.searchParams.set('village', scope.sourceVillageId);
        url.searchParams.set('screen', 'report');
        url.searchParams.set('view', String(reportId));
        return url.toString();
    }

    function reportIndexUrl(scope, page) {
        const url = new URL('/game.php', root.location.origin);
        url.searchParams.set('village', scope.sourceVillageId);
        url.searchParams.set('screen', 'report');
        url.searchParams.set('mode', 'attack');
        if (Number(page) > 0) url.searchParams.set('page', String(Math.trunc(Number(page))));
        return url.toString();
    }

    async function persistReportIndex(scope, model, guard) {
        const current = model._metaRecord || await storage().readRecord('autofarm_meta', metaKey(scope, 'modelMeta'));
        const value = {
            ...(current?.value || {}),
            schema: core().ADAPTIVE_SCHEMA_VERSION,
            reportIndex: core().normalizeAdaptiveReportIndex(model.reportIndex),
            updatedAt: now()
        };
        const saved = await storage().putMetaCas(scope, 'modelMeta', Number(current?.revision) || 0, value, guard);
        model._metaRecord = saved;
        return saved;
    }

    async function scanReportIndex(scope, settings, map, model, guard) {
        let state = core().prepareAdaptiveReportIndexScope(model.reportIndex, map.targets, settings, now());
        const activeCoords = new Set(map.targets.keys());
        const historyCoords = new Set(core().normalizedCoordList(state.historyCoords));
        const ledgerIds = new Set((model.reportLedger || []).map(item => String(item.reportId || '')));
        const backlogIds = new Set((state.backlog || []).map(item => String(item.reportId || '')));
        for (const [reportId, discovered] of Object.entries(state.discovered || {})) {
            if (ledgerIds.has(reportId)) {
                state.discovered[reportId] = { ...discovered, state: 'COMPLETE', updatedAt: now() };
            } else if (discovered.state === 'OUT_OF_SCOPE' && activeCoords.has(String(discovered.targetCoord || '')) && !backlogIds.has(reportId)) {
                state.backlog.push({
                    reportId, targetCoord: String(discovered.targetCoord),
                    assistantAttackAt: discovered.assistantAttackAt ?? null,
                    discoveredAt: Number(discovered.discoveredAt) || now(), source: 'report-index-promoted'
                });
                backlogIds.add(reportId);
                state.discovered[reportId] = { ...discovered, state: 'BACKLOG', updatedAt: now() };
            }
        }
        if (state.backlog.length || !core().reportIndexWorkDue(state, now(), activeCoords)) {
            state.historyCoords = core().normalizedCoordList([...historyCoords]);
            state.detailsPending = state.backlog.length;
            model.reportIndex = state;
            await persistReportIndex(scope, model, guard);
            return { pagesRead: 0, backlog: state.backlog.length };
        }
        if (state.completedAt > 0) {
            state.completedAt = 0;
            state.nextPage = 0;
            state.cycleStartedAt = now();
        }
        const cutoff = now() - settings.adaptiveHistoryDays * 86400000;
        let page = state.nextPage;
        let pagesRead = 0;
        while (pagesRead < core().ADAPTIVE_REPORT_INDEX_PAGES_PER_PASS) {
            const read = await resilientRequest(scope, `report-index:${page}`, reportIndexUrl(scope, page), {
                method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }, guard);
            const doc = read.doc || parseHtml(read.text);
            const entries = core().parseReportIndexEntries(doc, null);
            const meta = core().reportIndexPageMeta(doc, page);
            pagesRead++;
            state.rawRowsSeen += Number(meta.rawReportCount || 0);
            for (const entry of entries) {
                const coord = String(entry.targetCoord || '');
                const reportId = String(entry.reportId || '');
                if (!coord || !reportId) continue;
                historyCoords.add(coord);
                const reportAt = core().finiteObservedNumber(entry.assistantAttackAt);
                const inHistory = reportAt === null || reportAt >= cutoff;
                const active = activeCoords.has(coord);
                if (active && inHistory && !ledgerIds.has(reportId) && !backlogIds.has(reportId)) {
                    state.backlog.push({ ...entry, discoveredAt: now(), source: 'report-index' });
                    backlogIds.add(reportId);
                    state.discovered[reportId] = {
                        reportId, targetCoord: coord, assistantAttackAt: reportAt,
                        discoveredAt: now(), updatedAt: now(), state: 'BACKLOG'
                    };
                } else if (!state.discovered[reportId]) {
                    state.discovered[reportId] = {
                        reportId, targetCoord: coord, assistantAttackAt: reportAt,
                        discoveredAt: now(), updatedAt: now(),
                        state: ledgerIds.has(reportId) ? 'COMPLETE' : 'OUT_OF_SCOPE'
                    };
                }
            }
            const knownTimes = entries.map(item => core().finiteObservedNumber(item.assistantAttackAt)).filter(value => value !== null);
            const reachedCutoff = knownTimes.length > 0 && Math.min(...knownTimes) < cutoff;
            const reachedEnd = core().reportIndexPageReachedEnd(meta, page);
            if (reachedCutoff || reachedEnd) {
                state.completedAt = now();
                state.completedThroughTimestamp = reachedCutoff ? cutoff :
                    (knownTimes.length ? Math.min(...knownTimes) : cutoff);
                state.nextPage = 0;
                state.cycleStartedAt = 0;
                state.nextIndexAt = now() + 6 * 3600000;
                break;
            }
            page++;
            state.nextPage = page;
            state.nextIndexAt = now() + Math.max(15000, settings.retrySeconds * 1000);
        }
        state.lastScanAt = now();
        state.lastIndexAt = state.lastScanAt;
        state.lastPageCount = pagesRead;
        state.historyCoords = core().normalizedCoordList([...historyCoords]);
        state.detailsPending = state.backlog.length;
        model.reportIndex = state;
        await persistReportIndex(scope, model, guard);
        diagnostic(scope, 'REPORT_INDEX', `${pagesRead} page(s)`, {
            historyCoords: state.historyCoords.length, backlog: state.backlog.length
        });
        return { pagesRead, backlog: state.backlog.length };
    }

    async function ingestReportDetails(scope, settings, records, assistant, model, guard) {
        const completeIds = new Set((model.reportLedger || [])
            .filter(record => String(record?.detailState || '') !== 'ASSISTANT_SUMMARY')
            .map(record => String(record.reportId || '')));
        const indexedRows = (model.reportIndex?.backlog || []).map(item => ({
            coord: item.targetCoord, reportId: item.reportId,
            assistantAttackAt: item.assistantAttackAt, haul: 'unknown', dot: 'unknown'
        }));
        const queueById = new Map([...assistant.rows.values(), ...indexedRows]
            .filter(row => row?.reportId && !completeIds.has(String(row.reportId)))
            .map(row => [String(row.reportId), row]));
        const queue = [...queueById.values()]
            .sort((a, b) => Number(Boolean(records.targets?.value?.[b.coord]?.pending)) - Number(Boolean(records.targets?.value?.[a.coord]?.pending)) ||
                Number(b.assistantAttackAt || 0) - Number(a.assistantAttackAt || 0))
            .slice(0, settings.adaptiveReportFetchPerPass);
        let committed = 0;
        let reportIndexChanged = false;
        for (const row of queue) {
            guard?.assertActive?.();
            let read;
            try {
                read = await resilientRequest(scope, `report:${row.reportId}`, reportDetailUrl(scope, row.reportId), {
                    method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest' }
                }, guard);
            } catch (error) {
                if (error?.code === 'HARD_STOP' || [401, 403, 429].includes(Number(error?.status))) throw error;
                if ([404, 410].includes(Number(error?.status)) && model.reportIndex) {
                    model.reportIndex.backlog = model.reportIndex.backlog.filter(
                        item => String(item.reportId) !== String(row.reportId)
                    );
                    model.reportIndex.discovered = model.reportIndex.discovered || {};
                    model.reportIndex.discovered[row.reportId] = {
                        ...(model.reportIndex.discovered[row.reportId] || {}),
                        reportId: String(row.reportId), targetCoord: String(row.coord || ''),
                        assistantAttackAt: core().finiteObservedNumber(row.assistantAttackAt),
                        state: 'NOT_AVAILABLE_CONFIRMED', updatedAt: now()
                    };
                    model.reportIndex.detailsPending = model.reportIndex.backlog.length;
                    reportIndexChanged = true;
                    diagnostic(scope, 'REPORT_NOT_AVAILABLE', row.coord, {
                        reportId: row.reportId, status: Number(error.status)
                    });
                    continue;
                }
                if (model.reportIndex?.discovered?.[row.reportId]) {
                    model.reportIndex.discovered[row.reportId] = {
                        ...model.reportIndex.discovered[row.reportId],
                        state: 'RETRYABLE_READ_FAILURE', updatedAt: now()
                    };
                    reportIndexChanged = true;
                }
                diagnostic(scope, 'REPORT_RETRY', row.coord, { reportId: row.reportId, reason: error.message });
                continue;
            }
            const farm = core().normalizeAdaptiveFarm(model.farms?.[row.coord], row.coord, distance(row.coord));
            const targetState = records.targets?.value?.[row.coord] || {};
            const dispatch = targetState.pendingMutationId
                ? model.dispatches.find(item => String(item.dispatchId || '') === String(targetState.pendingMutationId))
                : model.dispatches.find(item => String(item.reportIdMatched || '') === String(row.reportId));
            if (dispatch) {
                farm.pendingDispatch = {
                    ...dispatch,
                    expectedArrivalAt: Number(row.assistantAttackAt) || Number(dispatch.sentAt),
                    attributionNotBeforeAt: Number(dispatch.sentAt) - 2 * 60000,
                    attributionExpiresAt: (Number(row.assistantAttackAt) || Number(dispatch.sentAt)) + 30 * 60000
                };
            }
            const doc = read.doc || parseHtml(read.text);
            const observation = core().observationFromReport(doc, row, farm, null, settings, model);
            if (!observation?.evidenceRecognized) {
                if (model.reportIndex?.discovered?.[row.reportId]) {
                    model.reportIndex.discovered[row.reportId] = {
                        ...model.reportIndex.discovered[row.reportId],
                        state: 'PARSE_UNKNOWN', updatedAt: now()
                    };
                    reportIndexChanged = true;
                }
                diagnostic(scope, 'REPORT_PARSE_UNRECOGNIZED', row.coord, { reportId: row.reportId });
                continue;
            }
            const observedComposition = core().parseReportComposition(doc);
            const safelyMatched = Boolean(dispatch &&
                (String(dispatch.reportIdMatched || '') === String(row.reportId) || reportIsSafelyNewer(row, {
                    reportIdAtSend: targetState.reportIdAtSend || dispatch.reportIdAtSend,
                    transmittedAt: targetState.sentAt || dispatch.sentAt
                })) &&
                (!observedComposition || !dispatch.composition || core().sameComposition(dispatch.composition, observedComposition)));
            observation.pendingMatched = safelyMatched;
            observation.dispatchId = safelyMatched ? String(dispatch.dispatchId) : null;
            observation.attribution = safelyMatched ? 'AUTO_MATCHED' : (targetState.pending ? 'UNATTRIBUTED' : 'EXTERNAL');
            observation.reason = safelyMatched ? String(dispatch.reason || 'AUTO_MATCHED') : `OBSERVED_${observation.attribution}`;
            root.PremiumFeaturesAutoFarmAdaptiveNativeSemanticCall = true;
            try {
                core().updateAdaptiveObservation(model, farm, observation, settings, scope.sourceVillageId);
            } finally {
                root.PremiumFeaturesAutoFarmAdaptiveNativeSemanticCall = false;
            }
            model.farms[row.coord] = farm;
            const operational = core().operationalResultFromReportObservation(observation) ||
                resultFromAssistantRow(row, settings, now());
            const cooldownMinutes = operational.kind === 'loss' ? settings.lossCooldownMin :
                operational.kind === 'full' ? settings.fullCooldownMin :
                    operational.kind === 'clean' ? settings.cleanCooldownMin : settings.unknownCooldownMin;
            const event = [...(model.events || [])].reverse().find(item => String(item?.reportId || '') === String(row.reportId));
            const report = core().normalizeAdaptiveReportLedgerEntry({
                reportId: String(row.reportId), targetCoord: row.coord,
                timestamp: observation.timestamp, recordedAt: now(), detailState: 'COMPLETE',
                quantitative: Boolean(core().hasObservedNumber(observation.lootTotal) ||
                    core().hasObservedNumber(observation.stockObservation?.value) ||
                    core().hasObservedNumber(observation.stockObservation?.low)),
                attribution: observation.attribution, dispatchId: observation.dispatchId,
                capacity: observation.transportCapacity, reportCapacity: observation.reportCapacity,
                reconstructedCapacity: observation.reconstructedCapacity,
                capacitySource: observation.capacitySource, loot: observation.lootTotal,
                remainingResources: observation.remainingResources,
                efficiency: observation.efficiency, rawEfficiency: observation.rawEfficiency,
                evidenceType: observation.stockObservation?.type,
                stock: observation.stockObservation?.value,
                stockLow: observation.stockObservation?.low,
                stockHigh: observation.stockObservation?.high,
                hadLosses: observation.hadLosses, source: 'report-detail'
            }, scope.sourceVillageId);
            const outcome = await storage().commitLearnedReport(scope, {
                farm, report, event,
                matchedDispatchId: safelyMatched ? dispatch.dispatchId : null,
                resultKind: operational.kind,
                cooldownUntil: now() + cooldownMinutes * 60000
            }, guard);
            if (outcome?.status === 'COMMITTED') {
                committed++;
                model.reportLedger.push(report);
                if (model.reportIndex) {
                    model.reportIndex.backlog = model.reportIndex.backlog.filter(item => String(item.reportId) !== String(row.reportId));
                    if (model.reportIndex.discovered?.[row.reportId]) {
                        model.reportIndex.discovered[row.reportId] = {
                            ...model.reportIndex.discovered[row.reportId], state: 'COMPLETE', updatedAt: now()
                        };
                    }
                    model.reportIndex.detailsPending = model.reportIndex.backlog.length;
                    reportIndexChanged = true;
                }
                diagnostic(scope, 'REPORT_LEARNED', row.coord, {
                    reportId: row.reportId, attribution: observation.attribution,
                    quantitative: report.quantitative
                });
            }
        }
        if (committed) {
            records.targets = await storage().readRecord('autofarm_operational', metaKey(scope, 'targetStates'));
        }
        if (committed || reportIndexChanged) {
            await persistReportIndex(scope, model, guard);
        }
        return committed;
    }

    async function buildObservation(scope, settingsRecord, guard) {
        const settings = core().normalizeCfg(settingsRecord.value);
        const [map, records, model, previousPresence] = await Promise.all([
            readMap(scope, settings, guard),
            ensureNativeRecords(scope),
            loadModel(scope),
            storage().readRecord('autofarm_meta', metaKey(scope, 'mapPresence'))
        ]);
        guard?.assertActive?.();
        const assistant = await readAssistant(scope, settings, map.targets, guard);
        await scanReportIndex(scope, settings, map, model, guard);
        await ingestReportDetails(scope, settings, records, assistant, model, guard);
        await synchronizePendingAssistantReports(scope, settings, records, assistant, guard);
        const capacity = chooseTemplateAndCapacity(assistant, settings, scope.sourceVillageId);
        const targetStates = records.targets?.value || {};
        const timestamp = now();
        const presence = core().nextMapPresenceState(
            previousPresence?.value || {}, [...map.targets.keys()], [], timestamp,
            `${scopeKey(scope)}:${villageCoord()}`, settings.radius,
            core().MAP_BOOTSTRAP_CONFIRM_MIN_MS, []
        );
        const confirmed = new Set(presence.confirmedCoords || []);
        const candidates = [];
        for (const [coord, targetId] of map.targets) {
            const state = targetStates[coord] || {};
            if (targetStateBlocked(state, timestamp)) continue;
            const row = assistant.rows.get(coord);
            if (row) {
                if (!row.buttonSupported || row.disabled || String(row.templateId || '') !== String(capacity.templateId || '')) continue;
                candidates.push(makeCandidate(coord, targetId, row, model, settings, timestamp));
                continue;
            }
            const bootstrap = confirmed.has(coord) && assistant.coversRadius && !historicalEvidence(coord, model, state);
            if (bootstrap && capacity.templateId) {
                candidates.push(makeCandidate(coord, targetId, { templateId: capacity.templateId }, model, settings, timestamp, true));
            }
        }
        return { settings, records, model, map, assistant, capacity, presence, previousPresence, candidates, timestamp };
    }

    function rankCandidates(observation) {
        const { candidates, model, settings, capacity, timestamp } = observation;
        if (!settings.adaptiveEnabled) {
            return [...candidates].sort((a, b) => Number(b.due) - Number(a.due) || a.distance - b.distance);
        }
        try {
            const templateContext = core().buildAdaptiveTemplateContext(capacity.composition, null, settings.adaptiveReferenceCapacity);
            return core().rankAdaptiveEligible(candidates, model, observation.records.settings.sourceVillageId,
                settings, timestamp, {
                    composition: capacity.composition,
                    unitInfo: null,
                    capacity: settings.adaptiveReferenceCapacity,
                    templateContext,
                    contextStats: core().adaptiveContextStats(model, settings, timestamp)
                });
        } catch (error) {
            diagnostic(currentScope(observation.records.settings.sourceVillageId), 'RANK_FALLBACK', error.message);
            return [...candidates].sort((a, b) => Number(b.due) - Number(a.due) || a.distance - b.distance);
        }
    }

    function compactCandidate(candidate) {
        return {
            coord: candidate.coord,
            targetId: String(candidate.targetId),
            templateId: String(candidate.templateId),
            reportId: candidate.reportId ? String(candidate.reportId) : null,
            distance: Number(candidate.distance) || 0,
            bootstrap: Boolean(candidate.bootstrap),
            reason: String(candidate.reason || candidate.adaptiveReason || 'DUE')
        };
    }

    async function persistObservationPlan(scope, observation, guard) {
        const { settings, records, map, assistant, capacity, presence, candidates, timestamp } = observation;
        const settingsRecord = records.settings;
        if (!capacity.usable || capacity.capacity <= 0 || !candidates.length) {
            const waitReason = !capacity.usable ? capacity.reason : (capacity.capacity <= 0 ? 'CAPACITY_ZERO' : 'NO_CANDIDATES');
            const coordinationValue = core().normalizeCoordinationState({
                ...records.coordination.value,
                state: 'WAITING_WORK', executionPlan: null, stochasticPlan: null,
                executionRound: null, reason: waitReason,
                sources: {
                    ...records.coordination.value?.sources,
                    MAP: { ...map.proof, source: 'MAP', data: map.proof },
                    ASSISTANT: { ...assistant.proof, source: 'ASSISTANT', data: { pagesRead: assistant.pagesRead, coversRadius: assistant.coversRadius } },
                    CAPACITY: capacity.proof ? { ...capacity.proof, source: 'CAPACITY', data: capacity.proof } : { source: 'CAPACITY', status: 'UNKNOWN' }
                }
            });
            await storage().putMetaCas(scope, 'coordination', records.coordination.revision, coordinationValue, guard);
            await storage().putMetaCas(scope, 'mapPresence', previousRevision(observation, 'mapPresence'), presence.state, guard)
                .catch(error => { if (error.code !== 'AUTOFARM_CAS_MISMATCH') throw error; });
            return { planned: false, reason: waitReason };
        }
        const ranked = rankCandidates(observation).slice(0, Math.min(settings.maxSendsPerPass, capacity.capacity));
        const generation = Math.max(0, Number(records.coordination.value?.generation) || 0) + 1;
        const planRevision = Math.max(0, Number(records.coordination.value?.planRevision) || 0) + 1;
        const roundId = `${scope.sourceVillageId}:${generation}:${timestamp}`;
        const cycleId = `${roundId}:1`;
        const proofEnd = Math.min(map.proof.authorizationFreshUntil, assistant.proof.freshUntil, capacity.proof.freshUntil);
        const notBeforeAt = timestamp;
        const stochasticRandom = core().createRandomSource(null, 'scheduling');
        const stochastic = core().generateStochasticPlan({
            now: timestamp, mode: settings.stochasticSchedulingMode, cycleId, generation, planRevision,
            ownerId: coordinator()?.instanceId || '', earliestExecutionAt: notBeforeAt,
            latestCheapExecutionAt: proofEnd - core().PLAN_PROOF_MARGIN_MS,
            maxHoldAt: proofEnd - core().PLAN_PROOF_MARGIN_MS,
            knownDispatchBudget: capacity.capacity, readyCandidateCount: ranked.length,
            configuredMaximum: settings.maxSendsPerPass,
            randomSources: {
                coalescing: core().createRandomSource(null, 'coalescing'),
                scheduling: stochasticRandom
            }
        }, stochasticRandom);
        if (!(stochastic.executionDueAt > 0)) return { planned: false, reason: 'INVALID_STOCHASTIC_WINDOW' };
        const round = core().normalizeExecutionRound({
            executionRoundId: roundId, cycleId, generation, planRevision,
            sourceVillageId: scope.sourceVillageId, configuredLimit: settings.maxSendsPerPass,
            dispatchLimitRemaining: Math.min(settings.maxSendsPerPass, capacity.capacity, ranked.length),
            createdAt: timestamp, status: 'OPEN'
        });
        const plan = core().normalizeExecutionPlan({
            executionRoundId: roundId, cycleId, generation, planRevision, createdAt: timestamp,
            notBeforeAt, sourceVillageId: scope.sourceVillageId, radius: settings.radius,
            farmTemplate: settings.farmTemplate, templateId: capacity.templateId,
            candidates: ranked.map(compactCandidate), dispatchLimitRemaining: round.dispatchLimitRemaining,
            capacityProof: capacity.proof, composition: capacity.composition,
            compositionAuthoritative: true, sourceRevisions: {
                settings: settingsRecord.revision, map: map.proof.revision,
                assistant: assistant.proof.revision, capacity: capacity.proof.observedAt
            },
            requiredSources: ['MAP', 'ASSISTANT', 'TEMPLATE', 'CAPACITY'],
            reason: 'native-observation'
        });
        const coordinationValue = core().normalizeCoordinationState({
            ...records.coordination.value, generation, planRevision,
            state: 'WAITING_EXECUTION', executionRound: round, executionPlan: plan,
            stochasticPlan: stochastic, executionDueAt: stochastic.executionDueAt,
            nextWakeAt: stochastic.executionDueAt, wakeKind: 'EXECUTION', reason: 'native-plan',
            sources: {
                ...records.coordination.value?.sources,
                MAP: { ...map.proof, source: 'MAP', data: map.proof },
                ASSISTANT: { ...assistant.proof, source: 'ASSISTANT', data: { pagesRead: assistant.pagesRead, coversRadius: assistant.coversRadius } },
                TEMPLATE: {
                    source: 'TEMPLATE', status: 'READY', observedAt: capacity.proof.observedAt,
                    freshUntil: capacity.proof.freshUntil, revision: capacity.proof.observedAt,
                    data: { templateId: capacity.templateId, composition: capacity.composition, authoritative: true }
                },
                CAPACITY: { source: 'CAPACITY', status: 'READY', observedAt: capacity.proof.observedAt,
                    freshUntil: capacity.proof.freshUntil, revision: capacity.proof.observedAt, data: capacity.proof }
            }
        });
        await storage().putMetaCas(scope, 'coordination', records.coordination.revision, coordinationValue, guard);
        await storage().putMetaCas(scope, 'mapPresence', previousRevision(observation, 'mapPresence'), presence.state, guard)
            .catch(error => { if (error.code !== 'AUTOFARM_CAS_MISMATCH') throw error; });
        schedule(scope, stochastic.executionDueAt, 'EXECUTION');
        return { planned: true, plan, round, stochastic };
    }

    function previousRevision(observation, type) {
        if (type === 'mapPresence') return Number(observation.previousPresence?.revision) || 0;
        return Number(observation.records?.[type]?.revision) || 0;
    }

    function schedule(scope, dueAt, wakeKind, priority) {
        const service = scheduler();
        if (!service) throw coded('AUTOFARM_SCHEDULER_MISSING', 'TWPF scheduler is unavailable');
        service.enqueue({
            key: taskKey(scope),
            handlerName: HANDLER,
            args: [scope, String(wakeKind || 'OBSERVATION')],
            priority: priority || service.PRIORITY?.AUTOMATIC || 3,
            dueAt: Math.max(now(), Number(dueAt) || now()),
            dueMode: service.DUE_MODE?.REPLACE || 'REPLACE',
            leaseKey: leaseKey(scope),
            leaseTtlMs: 120000,
            requiresCoordinator: true,
            persist: true,
            rerunWhileActive: true
        });
        return true;
    }

    async function updateCoordination(scope, transform, guard) {
        const record = await storage().readRecord('autofarm_meta', metaKey(scope, 'coordination'));
        if (!record) throw coded('AUTOFARM_COORDINATION_MISSING', 'Coordination state is unavailable');
        guard?.assertActive?.();
        const value = core().normalizeCoordinationState(transform(core().normalizeCoordinationState(record.value)));
        return storage().putMetaCas(scope, 'coordination', record.revision, value, guard);
    }

    function predictionForCandidate(candidate, model, settings, timestamp) {
        const farm = core().normalizeAdaptiveFarm(model.farms?.[candidate.coord], candidate.coord, candidate.distance);
        try {
            const prediction = core().predictAdaptiveFarm(
                farm, timestamp, model, settings, settings.adaptiveReferenceCapacity
            );
            const expectedLoot = Number(prediction?.expectedLoot);
            const capacity = Number(prediction?.capacity || settings.adaptiveReferenceCapacity);
            return {
                ...prediction,
                expectedEfficiency: Number.isFinite(expectedLoot) && capacity > 0 ? expectedLoot / capacity : null
            };
        } catch (_) {
            return { expectedLoot: null, expectedEfficiency: null, fullProbability: null };
        }
    }

    function finalCandidateAllowed(candidate, prediction, settings) {
        if (candidate.bootstrap || ['MUST_PROBE', 'FORCED_COVERAGE'].includes(candidate.reason)) return true;
        const efficiency = Number(prediction?.expectedEfficiency);
        return !Number.isFinite(efficiency) || efficiency >= settings.adaptiveMinDispatchEfficiency;
    }

    function parsePostJson(text) {
        try { return JSON.parse(String(text || '')); }
        catch (_) { throw coded('AUTOFARM_RESPONSE_UNKNOWN', 'Farm response was not valid JSON'); }
    }

    async function sendFarm(scope, candidate, plan, guard) {
        const endpoint = core().buildFarmSendEndpoint(scope.sourceVillageId);
        const body = new URLSearchParams({
            target: String(candidate.targetId),
            template_id: String(plan.templateId),
            source: String(scope.sourceVillageId)
        });
        const response = await resilientRequest(scope, `post:${candidate.coord}`, endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body
        }, guard, true);
        return parsePostJson(response.text);
    }

    async function installPostCapacity(scope, plan, data, guard) {
        const units = core().normalizeUnitCounts(data?.current_units, true);
        const value = units && plan.compositionAuthoritative && plan.composition
            ? core().capacityForComposition(plan.composition, units)
            : null;
        return updateCoordination(scope, state => {
            const timestamp = now();
            if (Number.isFinite(value)) {
                const proof = core().normalizeCapacityProof({
                    value, exact: true, authoritative: true,
                    observedAt: timestamp, freshUntil: timestamp + CAPACITY_TTL_MS,
                    source: 'POST_CURRENT_UNITS', templateId: plan.templateId,
                    farmTemplate: plan.farmTemplate, composition: plan.composition,
                    compositionAuthoritative: true, currentUnits: units,
                    sourceVillageId: scope.sourceVillageId
                });
                state.sources.CAPACITY = {
                    source: 'CAPACITY', status: 'READY', observedAt: timestamp,
                    freshUntil: proof.freshUntil, revision: timestamp, data: proof
                };
            } else {
                state.sources.CAPACITY = {
                    source: 'CAPACITY', status: 'STALE', observedAt: timestamp,
                    freshUntil: 0, invalidated: true, revision: timestamp,
                    reason: 'MUTATION_CONFIRMED_WITHOUT_CURRENT_UNITS', data: null
                };
            }
            return state;
        }, guard);
    }

    async function scheduleSuccessor(scope, settings, guard) {
        const coordinationRecord = await storage().readRecord('autofarm_meta', metaKey(scope, 'coordination'));
        const state = core().normalizeCoordinationState(coordinationRecord?.value);
        const plan = core().normalizeExecutionPlan(state.executionPlan);
        const round = core().normalizeExecutionRound(state.executionRound);
        const proof = core().normalizeCapacityProof(state.sources.CAPACITY?.data);
        const remaining = plan.candidates.slice(1);
        const budget = core().successorDispatchBudget(round, proof, remaining.length, {
            sourceVillageId: scope.sourceVillageId,
            templateId: plan.templateId,
            farmTemplate: plan.farmTemplate
        }, now());
        if (!(budget > 0) || !remaining.length) return false;
        const dueAt = Math.max(now() + Math.max(0, Number(settings.attemptGapMs) || 0), Number(plan.notBeforeAt) || 0);
        const proofEnd = core().coordinationProofEnd(state, plan.requiredSources, now());
        if (!(proofEnd >= dueAt + core().PLAN_PROOF_MARGIN_MS)) return false;
        const generation = Number(state.generation) + 1;
        const cycleId = `${round.executionRoundId}:${generation}`;
        const stochasticRandom = core().createRandomSource(null, 'scheduling');
        const stochastic = core().generateStochasticPlan({
            now: now(), mode: settings.stochasticSchedulingMode, cycleId,
            generation, planRevision: state.planRevision, ownerId: coordinator()?.instanceId || '',
            earliestExecutionAt: dueAt,
            latestCheapExecutionAt: proofEnd - core().PLAN_PROOF_MARGIN_MS,
            maxHoldAt: proofEnd - core().PLAN_PROOF_MARGIN_MS,
            knownDispatchBudget: budget, readyCandidateCount: remaining.length,
            configuredMaximum: settings.maxSendsPerPass,
            randomSources: {
                coalescing: core().createRandomSource(null, 'coalescing'),
                scheduling: stochasticRandom
            }
        }, stochasticRandom);
        if (!(stochastic.executionDueAt > 0)) return false;
        const updated = await storage().putMetaCas(scope, 'coordination', coordinationRecord.revision,
            core().normalizeCoordinationState({
                ...state, generation, state: 'WAITING_EXECUTION', wakeKind: 'EXECUTION',
                nextWakeAt: stochastic.executionDueAt, executionDueAt: stochastic.executionDueAt,
                stochasticPlan: stochastic,
                executionRound: { ...round, cycleId, generation },
                executionPlan: { ...plan, cycleId, generation, candidates: remaining, capacityProof: proof },
                reason: 'native-successor'
            }), guard);
        runtime.records.set(scopeKey(scope), { ...(runtime.records.get(scopeKey(scope)) || {}), coordination: updated });
        schedule(scope, stochastic.executionDueAt, 'EXECUTION');
        return true;
    }

    async function executeOccurrence(scope, guard) {
        assertNetworkAllowed(guard);
        const records = await ensureNativeRecords(scope);
        const settings = core().normalizeCfg(records.settings.value);
        if (!settings.enabled) return { status: 'DISABLED' };
        const coordinationRecord = await storage().readRecord('autofarm_meta', metaKey(scope, 'coordination'));
        const state = core().normalizeCoordinationState(coordinationRecord?.value);
        const plan = core().normalizeExecutionPlan(state.executionPlan);
        const round = core().normalizeExecutionRound(state.executionRound);
        if (state.state !== 'WAITING_EXECUTION' || !plan.candidates.length || round.status !== 'OPEN' ||
            !(round.dispatchLimitRemaining > 0) || round.pendingMutation) {
            return { status: 'NO_EXECUTION_PLAN' };
        }
        if (plan.generation !== state.generation || plan.planRevision !== state.planRevision ||
            String(plan.sourceVillageId) !== scope.sourceVillageId ||
            Number(plan.sourceRevisions?.settings) !== Number(records.settings.revision)) {
            throw coded('STALE_GENERATION', 'Execution plan was fenced by newer state');
        }
        if (now() < Number(plan.notBeforeAt || 0)) {
            schedule(scope, plan.notBeforeAt, 'EXECUTION');
            return { status: 'NOT_BEFORE' };
        }
        const candidate = plan.candidates[0];
        const mapSource = state.sources.MAP;
        const assistantSource = state.sources.ASSISTANT;
        const templateSource = state.sources.TEMPLATE;
        const capacityProof = core().normalizeCapacityProof(state.sources.CAPACITY?.data);
        const currentTime = now();
        const authorizationAt = currentTime + core().PLAN_PROOF_MARGIN_MS;
        if (!mapSource || Number(mapSource.data?.authorizationFreshUntil || 0) < authorizationAt ||
            String(mapSource.data?.targetIds?.[candidate.coord] || '') !== String(candidate.targetId) ||
            !core().coordinationSourceFreshForPlanning(assistantSource, currentTime) ||
            !core().coordinationSourceFreshForPlanning(templateSource, currentTime) ||
            !core().capacityProofUsable(capacityProof, {
                sourceVillageId: scope.sourceVillageId,
                templateId: plan.templateId,
                farmTemplate: plan.farmTemplate
            }, authorizationAt) || !(capacityProof.value > 0)) {
            await updateCoordination(scope, value => ({
                ...value, state: 'WAITING_WORK', executionPlan: null, stochasticPlan: null,
                executionDueAt: 0, reason: 'FINAL_PROOF_STALE'
            }), guard);
            schedule(scope, currentTime + 1000, 'OBSERVATION');
            return { status: 'PROOF_STALE' };
        }
        const targetRecord = await storage().readRecord('autofarm_operational', metaKey(scope, 'targetStates'));
        if (targetStateBlocked(targetRecord?.value?.[candidate.coord], currentTime)) {
            throw coded('AUTOFARM_TARGET_PENDING', 'Target became pending before final gate');
        }
        assertActiveVillage(scope);
        assertLegacyStandaloneInactive(scope);
        const model = await loadModel(scope);
        const prediction = predictionForCandidate(candidate, model, settings, currentTime);
        if (!finalCandidateAllowed(candidate, prediction, settings)) {
            await updateCoordination(scope, value => ({
                ...value, state: 'WAITING_WORK', executionPlan: null, stochasticPlan: null,
                executionDueAt: 0, reason: 'ECONOMIC_GATE'
            }), guard);
            return { status: 'ECONOMIC_GATE' };
        }
        const mutationId = `${scopeKey(scope)}:${round.executionRoundId}:${candidate.coord}:${currentTime}`;
        const mutation = await storage().prepareMutation(scope, {
            mutationId,
            dispatchId: mutationId,
            executionRoundId: round.executionRoundId,
            cycleId: plan.cycleId,
            generation: plan.generation,
            planRevision: plan.planRevision,
            settingsRevision: records.settings.revision,
            coordinationRevision: coordinationRecord.revision,
            targetCoord: candidate.coord,
            targetId: candidate.targetId,
            templateId: plan.templateId,
            farmTemplate: plan.farmTemplate,
            reportIdAtSend: candidate.reportId,
            composition: plan.composition,
            capacity: capacityProof.value,
            prediction
        }, guard);
        assertActiveVillage(scope);
        await storage().markMutationTransmitting(scope, mutation.mutationId, guard);
        diagnostic(scope, 'POST_ATTEMPT', candidate.coord, { mutationId });
        let data;
        try {
            data = await sendFarm(scope, candidate, plan, guard);
        } catch (error) {
            await storage().settleMutation(scope, mutation.mutationId, 'UNKNOWN', {
                code: error.code || '', message: error.message, status: error.status || 0
            }, guard);
            diagnostic(scope, 'POST_UNKNOWN', candidate.coord, { mutationId, reason: error.message });
            schedule(scope, now() + REPORT_RETRY_MS, 'RECONCILIATION', scheduler()?.PRIORITY?.RECONCILIATION);
            return { status: 'UNKNOWN' };
        }
        const classification = core().classifyFarmResponse(data);
        if (classification.kind === 'success') {
            await storage().settleMutation(scope, mutation.mutationId, 'CONFIRMED', { classification, data }, guard);
            await installPostCapacity(scope, plan, data, guard);
            diagnostic(scope, 'POST_CONFIRMED', candidate.coord, { mutationId });
            if (!await scheduleSuccessor(scope, settings, guard)) {
                schedule(scope, now() + settings.retrySeconds * 1000, 'OBSERVATION');
            }
            return { status: 'CONFIRMED', candidate };
        }
        if (classification.kind === 'no-units') {
            await storage().settleMutation(scope, mutation.mutationId, 'REJECTED', { classification }, guard);
            await updateCoordination(scope, value => {
                const timestamp = now();
                const zero = core().normalizeCapacityProof({
                    value: 0, exact: true, authoritative: true, observedAt: timestamp,
                    freshUntil: timestamp + 60000, source: 'SERVER_NO_UNITS',
                    templateId: plan.templateId, farmTemplate: plan.farmTemplate,
                    composition: plan.composition, compositionAuthoritative: plan.compositionAuthoritative,
                    sourceVillageId: scope.sourceVillageId
                });
                value.sources.CAPACITY = { source: 'CAPACITY', status: 'READY', observedAt: timestamp,
                    freshUntil: zero.freshUntil, revision: timestamp, data: zero };
                value.state = 'WAITING_WORK';
                value.executionPlan = null;
                value.stochasticPlan = null;
                value.reason = 'SERVER_NO_UNITS';
                return value;
            }, guard);
            schedule(scope, now() + 60000, 'OBSERVATION');
            return { status: 'NO_UNITS' };
        }
        if (classification.kind === 'rejected') {
            await storage().settleMutation(scope, mutation.mutationId, 'REJECTED', { classification }, guard);
            diagnostic(scope, 'POST_REJECTED', classification.message, { mutationId });
            schedule(scope, now() + settings.retrySeconds * 1000, 'OBSERVATION');
            return { status: 'REJECTED' };
        }
        await storage().settleMutation(scope, mutation.mutationId, 'UNKNOWN', { classification }, guard);
        if (classification.kind === 'protection') {
            root.PremiumFeaturesBackgroundScheduler?.hardStop?.({ source: 'bot-protection', feature: FEATURE });
            root.PremiumFeaturesCoordination?.broadcast?.('hard-stop', { source: 'bot-protection', feature: FEATURE });
            root.PremiumFeaturesBotProtection?.suspendForHardStop?.();
        } else {
            schedule(scope, now() + REPORT_RETRY_MS, 'RECONCILIATION', scheduler()?.PRIORITY?.RECONCILIATION);
        }
        return { status: 'UNKNOWN' };
    }

    function reportIsSafelyNewer(row, mutation) {
        if (!row?.reportId) return false;
        const baseline = String(mutation?.reportIdAtSend || '');
        const relation = baseline ? core().adaptiveReportIdRelation(row.reportId, baseline) : 1;
        if (relation !== 1) return false;
        const reportAt = Number(row.assistantAttackAt || 0);
        const sentAt = Number(mutation?.transmittedAt || mutation?.preparedAt || 0);
        return reportAt > 0 && sentAt > 0 && reportAt >= sentAt - 2 * 60000;
    }

    async function unresolvedMutations(scope) {
        const records = await storage().readIndex(
            'autofarm_mutations', 'by_village',
            [scope.world, scope.playerId, scope.sourceVillageId]
        );
        return records.filter(record => ['PREPARED', 'TRANSMITTING', 'UNKNOWN'].includes(String(record?.status || '')));
    }

    async function reconcileOccurrence(scope, guard) {
        assertNetworkAllowed(guard);
        const records = await ensureNativeRecords(scope);
        const settings = core().normalizeCfg(records.settings.value);
        if (!settings.enabled) return { status: 'DISABLED' };
        const unresolved = await unresolvedMutations(scope);
        if (!unresolved.length) {
            await updateCoordination(scope, value => ({
                ...value, state: 'WAITING_WORK', reason: 'RECONCILIATION_EMPTY'
            }), guard);
            schedule(scope, now() + 1000, 'OBSERVATION');
            return { status: 'EMPTY' };
        }

        // PREPARED is durable proof that the network mutation had not begun. It is
        // the only crash state that may be rolled back without observing the server.
        for (const mutation of unresolved.filter(item => item.status === 'PREPARED')) {
            await storage().settleMutation(scope, mutation.mutationId, 'NOT_SENT', {
                reason: 'recovered-before-transmit'
            }, guard);
            diagnostic(scope, 'MUTATION_NOT_SENT', mutation.targetCoord, { mutationId: mutation.mutationId });
        }

        const uncertain = (await unresolvedMutations(scope))
            .filter(item => ['TRANSMITTING', 'UNKNOWN'].includes(item.status));
        if (!uncertain.length) {
            schedule(scope, now() + 1000, 'OBSERVATION');
            return { status: 'ROLLED_BACK_PREPARED' };
        }
        const targetMap = new Map(uncertain.map(item => [String(item.targetCoord), String(item.targetId)]));
        const assistant = await readAssistant(scope, settings, targetMap, guard);
        let matched = 0;
        for (const mutation of uncertain) {
            const row = assistant.rows.get(String(mutation.targetCoord));
            if (reportIsSafelyNewer(row, mutation)) {
                await storage().settleMutation(scope, mutation.mutationId, 'CONFIRMED', {
                    reason: 'later-assistant-report', reportId: row.reportId,
                    reportAt: row.assistantAttackAt
                }, guard);
                matched++;
                diagnostic(scope, 'MUTATION_RECONCILED_SENT', mutation.targetCoord, {
                    mutationId: mutation.mutationId, reportId: row.reportId
                });
            } else if (mutation.status === 'TRANSMITTING') {
                await storage().settleMutation(scope, mutation.mutationId, 'UNKNOWN', {
                    reason: 'no-safe-report-proof-yet'
                }, guard);
            }
        }
        if ((await unresolvedMutations(scope)).length) {
            schedule(scope, now() + REPORT_RETRY_MS, 'RECONCILIATION', scheduler()?.PRIORITY?.RECONCILIATION);
            return { status: 'STILL_UNKNOWN', matched };
        }
        schedule(scope, now() + 1000, 'OBSERVATION');
        return { status: 'RECONCILED', matched };
    }

    async function observationOccurrence(scope, guard) {
        assertNetworkAllowed(guard);
        const records = await ensureNativeRecords(scope);
        const settings = core().normalizeCfg(records.settings.value);
        if (!settings.enabled) return { status: 'DISABLED' };
        const unresolved = await unresolvedMutations(scope);
        if (unresolved.length) {
            schedule(scope, now(), 'RECONCILIATION', scheduler()?.PRIORITY?.RECONCILIATION);
            return { status: 'RECONCILIATION_REQUIRED' };
        }
        diagnostic(scope, 'OBSERVATION_START', 'fresh MAP and Assistant proofs');
        const observation = await buildObservation(scope, records.settings, guard);
        guard?.assertActive?.();
        const result = await persistObservationPlan(scope, observation, guard);
        diagnostic(scope, result.planned ? 'PLAN_READY' : 'WAITING_WORK', result.reason || 'native-plan', {
            candidates: observation.candidates.length,
            capacity: observation.capacity?.capacity ?? null,
            mapTargets: observation.map.targets.size
        });
        if (!result.planned) {
            schedule(scope, now() + settings.retrySeconds * 1000, 'OBSERVATION');
        }
        return result;
    }

    function triggerHardStop(error) {
        const reason = {
            source: error?.status === 429 ? 'http-429' :
                error?.status === 403 ? 'http-403' : 'autofarm-fail-closed',
            feature: FEATURE,
            message: String(error?.message || error || 'AutoFarm hard-stop')
        };
        scheduler()?.hardStop?.(reason);
        coordinator()?.broadcast?.('hard-stop', reason);
        root.PremiumFeaturesBotProtection?.suspendForHardStop?.();
    }

    async function disableFailClosed(scope, error) {
        try {
            const record = await storage().readRecord('autofarm_meta', metaKey(scope, 'settings'));
            if (record) await storage().putMetaCas(scope, 'settings', record.revision,
                core().normalizeCfg({ ...record.value, enabled: false }));
            const coordinationRecord = await storage().readRecord('autofarm_meta', metaKey(scope, 'coordination'));
            if (coordinationRecord) await storage().putMetaCas(scope, 'coordination', coordinationRecord.revision,
                core().normalizeCoordinationState({
                    ...coordinationRecord.value,
                    generation: Number(coordinationRecord.value?.generation || 0) + 1,
                    state: 'SOFT_PAUSED', executionPlan: null, stochasticPlan: null,
                    nextWakeAt: 0, executionDueAt: 0,
                    reason: `FAIL_CLOSED:${String(error?.code || 'ERROR')}`
                }));
        } catch (storageError) {
            console.error('[TWPF AutoFarm] fail-closed persistence failed', storageError);
            triggerHardStop(storageError);
        }
        scheduler()?.cancel?.(taskKey(scope), 'autofarm-fail-closed');
        diagnostic(scope, 'FAIL_CLOSED', String(error?.message || error), { code: error?.code || '' });
    }

    async function runOccurrence(scopeInput, wakeKind, guard) {
        const activeVillageId = String(root.game_data?.village?.id || '');
        if (activeVillageId && String(scopeInput?.sourceVillageId || '') !== activeVillageId) {
            const parkedScope = currentScope(scopeInput?.sourceVillageId);
            schedule(parkedScope, now() + 5 * 60000, wakeKind || 'OBSERVATION');
            return { status: 'WRONG_ACTIVE_VILLAGE' };
        }
        const scope = currentScope(scopeInput?.sourceVillageId);
        if (scope.world !== String(scopeInput?.world || scope.world) ||
            scope.playerId !== String(scopeInput?.playerId || scope.playerId)) {
            throw coded('AUTOFARM_SCOPE_MISMATCH', 'Persisted task belongs to another account');
        }
        if (!featureAllowed()) {
            scheduler()?.cancel?.(taskKey(scope), 'feature-disabled');
            return { status: 'FEATURE_DISABLED' };
        }
        try {
            const kind = String(wakeKind || 'OBSERVATION').toUpperCase();
            const result = kind === 'EXECUTION'
                ? await executeOccurrence(scope, guard)
                : kind === 'RECONCILIATION'
                    ? await reconcileOccurrence(scope, guard)
                    : await observationOccurrence(scope, guard);
            render(scope);
            return result;
        } catch (error) {
            if (error?.code === 'LEASE_LOST' || error?.code === 'LEASE_UNAVAILABLE') throw error;
            if (error?.code === 'HARD_STOP' || [401, 403, 429].includes(Number(error?.status))) {
                triggerHardStop(error);
                diagnostic(scope, 'HARD_STOP', error.message, { code: error.code || '', status: error.status || 0 });
                const settingsRecord = await storage().readRecord('autofarm_meta', metaKey(scope, 'settings')).catch(() => null);
                if (settingsRecord?.value?.enabled) {
                    schedule(scope, now() + core().normalizeCfg(settingsRecord.value).retrySeconds * 1000, 'OBSERVATION');
                }
                return { status: 'HARD_STOP' };
            }
            if (/IDB|STORAGE|CAS|MUTATION|SCOPE|LEGACY/.test(String(error?.code || ''))) {
                await disableFailClosed(scope, error);
                return { status: 'FAIL_CLOSED', error };
            }
            diagnostic(scope, 'OCCURRENCE_FAILED', error.message, { code: error.code || '' });
            const records = await ensureNativeRecords(scope).catch(() => null);
            if (records?.settings?.value?.enabled) {
                schedule(scope, now() + core().normalizeCfg(records.settings.value).retrySeconds * 1000, 'OBSERVATION');
            }
            return { status: 'RETRY_SCHEDULED', error };
        }
    }

    async function setEnabled(scope, enabled) {
        if (hardStopped() && enabled) throw coded('HARD_STOP', 'Clear TWPF HARD_STOP before enabling AutoFarm');
        if (enabled) assertLegacyStandaloneInactive(scope);
        const records = await ensureNativeRecords(scope);
        const settings = core().normalizeCfg({ ...records.settings.value, enabled: Boolean(enabled) });
        const saved = await storage().putMetaCas(scope, 'settings', records.settings.revision, settings);
        const currentCoordination = await storage().readRecord('autofarm_meta', metaKey(scope, 'coordination'));
        const nextCoordination = core().normalizeCoordinationState({
            ...currentCoordination.value,
            generation: Number(currentCoordination.value?.generation || 0) + 1,
            state: enabled ? 'WAITING_WORK' : 'DISABLED',
            executionPlan: null, stochasticPlan: null, executionRound: null,
            nextWakeAt: 0, executionDueAt: 0,
            reason: enabled ? 'USER_ENABLED' : 'USER_DISABLED'
        });
        await storage().putMetaCas(scope, 'coordination', currentCoordination.revision, nextCoordination);
        if (enabled) schedule(scope, now(), 'OBSERVATION', scheduler()?.PRIORITY?.MANUAL);
        else scheduler()?.cancel?.(taskKey(scope), 'user-disabled');
        diagnostic(scope, enabled ? 'ENABLED' : 'DISABLED', 'user action', { settingsRevision: saved.revision });
        render(scope);
        return settings;
    }

    async function updateSettings(scope, patch) {
        const records = await ensureNativeRecords(scope);
        const next = core().normalizeCfg({ ...records.settings.value, ...(patch || {}) });
        const saved = await storage().putMetaCas(scope, 'settings', records.settings.revision, next);
        const coordinationRecord = await storage().readRecord('autofarm_meta', metaKey(scope, 'coordination'));
        await storage().putMetaCas(scope, 'coordination', coordinationRecord.revision,
            core().normalizeCoordinationState({
                ...coordinationRecord.value,
                generation: Number(coordinationRecord.value?.generation || 0) + 1,
                state: next.enabled ? 'WAITING_WORK' : 'DISABLED',
                executionPlan: null, stochasticPlan: null, executionRound: null,
                nextWakeAt: 0, executionDueAt: 0, reason: 'SETTINGS_CHANGED'
            }));
        if (next.enabled) schedule(scope, now(), 'OBSERVATION', scheduler()?.PRIORITY?.MANUAL);
        render(scope);
        return saved;
    }

    function panelId() { return 'twpf-autofarm-adaptive'; }

    function installPanel(scope) {
        if (!featureAllowed() || !root.document?.body) return;
        const existing = root.document.getElementById(panelId());
        if (existing?.dataset?.scope === scopeKey(scope)) return;
        existing?.remove?.();
        const panel = root.document.createElement('section');
        panel.id = panelId();
        panel.dataset.scope = scopeKey(scope);
        panel.innerHTML = `
            <style>
              #${panelId()}{position:fixed;left:12px;bottom:12px;z-index:99998;width:min(430px,calc(100vw - 24px));max-height:72vh;overflow:auto;background:#172027;color:#edf3f5;border:1px solid #b99551;border-radius:10px;box-shadow:0 12px 36px #0009;font:12px/1.4 Arial;padding:10px}
              #${panelId()} *{box-sizing:border-box} #${panelId()} header{display:flex;align-items:center;justify-content:space-between;gap:8px} #${panelId()} h3{margin:0;color:#e4b95f;font-size:14px} #${panelId()} .af-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0} #${panelId()} label{font-size:9px;color:#aab6bd} #${panelId()} input,#${panelId()} select,#${panelId()} button{width:100%;min-height:29px;margin-top:2px;background:#0e151a;color:#edf3f5;border:1px solid #ffffff24;border-radius:6px} #${panelId()} button{cursor:pointer;font-weight:700} #${panelId()} .af-primary{background:#d9aa50;color:#161108} #${panelId()} .af-state{padding:7px;background:#ffffff0b;border-radius:6px;margin:7px 0} #${panelId()} .af-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:8px 0} #${panelId()} .af-tab.active{border-color:#73d8ce;color:#bff3ed} #${panelId()} .af-pane{display:none} #${panelId()} .af-pane.active{display:block} #${panelId()} .af-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5px} #${panelId()} .af-kpis span{padding:6px;background:#ffffff0a;border-radius:6px;text-align:center;font-size:9px} #${panelId()} .af-kpis b{display:block;font-size:14px;color:#fff} #${panelId()} table{width:100%;border-collapse:collapse;font-size:9px} #${panelId()} th,#${panelId()} td{padding:4px;border-bottom:1px solid #ffffff12;text-align:right} #${panelId()} th:first-child,#${panelId()} td:first-child{text-align:left} #${panelId()} pre{max-height:180px;overflow:auto;white-space:pre-wrap;background:#090e11;padding:7px;border-radius:6px;font-size:9px} #${panelId()}[data-collapsed="true"] .af-body{display:none}
            </style>
            <header><h3>AutoFarm Adaptive <small>v${VERSION}</small></h3><button data-action="collapse" style="width:32px">−</button></header>
            <div class="af-body">
              <nav class="af-tabs"><button class="af-tab active" data-tab="now">Agora</button><button class="af-tab" data-tab="model">Modelo</button><button class="af-tab" data-tab="settings">Ajustes</button><button class="af-tab" data-tab="logs">Logs</button></nav>
              <section class="af-pane active" data-pane="now">
                <div class="af-state" data-role="status">A carregar estado nativo…</div>
                <div class="af-kpis"><span><b data-role="targets">—</b>alvos</span><span><b data-role="pending">—</b>pending</span><span><b data-role="reports">—</b>reports</span><span><b data-role="capacity">—</b>capacidade</span></div>
                <div class="af-grid"><button class="af-primary" data-action="toggle">INICIAR</button><button data-action="recheck">Reavaliar agora</button><button data-tab="settings">Configurar</button></div>
              </section>
              <section class="af-pane" data-pane="model">
                <div class="af-state" data-role="model-summary">Modelo ainda sem dados.</div>
                <table><thead><tr><th>Farm</th><th>Rating</th><th>Certeza</th><th>Próximo</th></tr></thead><tbody data-role="ranking"><tr><td colspan="4">Sem farms.</td></tr></tbody></table>
              </section>
              <section class="af-pane" data-pane="settings">
                <div class="af-grid">
                  <label>Modelo<select data-field="farmTemplate"><option>A</option><option>B</option></select></label>
                  <label>Raio<input data-field="radius" type="number" min="1" max="150"></label>
                  <label>Máx./ronda<input data-field="maxSendsPerPass" type="number" min="1" max="100"></label>
                  <label>Intervalo (s)<input data-field="retrySeconds" type="number" min="15"></label>
                  <label>Entre envios (s)<input data-field="attemptGapSeconds" type="number" min="0" step="0.1"></label>
                  <label>Estratégia<select data-field="adaptiveEnabled"><option value="true">Adaptativa</option><option value="false">Legada</option></select></label>
                  <label>Distribuição<select data-field="stochasticSchedulingMode"><option value="ADAPTIVE_SPREAD">Adaptativa</option><option value="IMMEDIATE_EFFICIENCY">Mais cedo</option></select></label>
                  <label>Histórico (dias)<input data-field="adaptiveHistoryDays" type="number" min="3" max="7"></label>
                  <label>Reports/passagem<input data-field="adaptiveReportFetchPerPass" type="number" min="1" max="12"></label>
                  <label>Máx. sem ver (h)<input data-field="adaptiveMaxUnseenHours" type="number" min="6" max="168"></label>
                  <label>Meta visita (%)<input data-field="adaptiveRevisitFillPercent" type="number" min="30" max="95"></label>
                  <label>Mínimo envio (%)<input data-field="adaptiveMinDispatchPercent" type="number" min="10" max="95"></label>
                  <label>Parcial (min)<input data-field="cleanCooldownMin" type="number" min="1"></label>
                  <label>Cheio (min)<input data-field="fullCooldownMin" type="number" min="0"></label>
                  <label>Perdas (min)<input data-field="lossCooldownMin" type="number" min="1"></label>
                </div>
                <button class="af-primary" data-action="save">Guardar e replanear</button>
              </section>
              <section class="af-pane" data-pane="logs"><pre data-role="logs">Sem eventos.</pre></section>
            </div>`;
        root.document.body.appendChild(panel);
        panel.addEventListener('click', async event => {
            const tab = event.target?.dataset?.tab;
            if (tab) {
                panel.querySelectorAll('.af-tab').forEach(node => node.classList.toggle('active', node.dataset.tab === tab));
                panel.querySelectorAll('.af-pane').forEach(node => node.classList.toggle('active', node.dataset.pane === tab));
                return;
            }
            const action = event.target?.dataset?.action;
            if (!action) return;
            if (action === 'collapse') {
                const collapsed = panel.dataset.collapsed === 'true';
                panel.dataset.collapsed = String(!collapsed);
                event.target.textContent = collapsed ? '−' : '+';
                return;
            }
            try {
                const records = await ensureNativeRecords(scope);
                if (action === 'toggle') await setEnabled(scope, !core().normalizeCfg(records.settings.value).enabled);
                if (action === 'recheck') {
                    if (!core().normalizeCfg(records.settings.value).enabled) throw coded('AUTOFARM_DISABLED', 'Inicia primeiro o AutoFarm');
                    schedule(scope, now(), 'OBSERVATION', scheduler()?.PRIORITY?.MANUAL);
                    diagnostic(scope, 'MANUAL_REEVALUATION', 'normal stochastic scheduling preserved');
                }
                if (action === 'save') {
                    const value = name => panel.querySelector(`[data-field="${name}"]`)?.value;
                    await updateSettings(scope, {
                        farmTemplate: value('farmTemplate'), radius: value('radius'),
                        maxSendsPerPass: value('maxSendsPerPass'), retrySeconds: value('retrySeconds'),
                        attemptGapMs: Number(value('attemptGapSeconds')) * 1000,
                        adaptiveEnabled: value('adaptiveEnabled') === 'true',
                        stochasticSchedulingMode: value('stochasticSchedulingMode'),
                        adaptiveHistoryDays: value('adaptiveHistoryDays'),
                        adaptiveReportFetchPerPass: value('adaptiveReportFetchPerPass'),
                        adaptiveMaxUnseenHours: value('adaptiveMaxUnseenHours'),
                        adaptiveRevisitFillThreshold: Number(value('adaptiveRevisitFillPercent')) / 100,
                        adaptiveMinDispatchEfficiency: Number(value('adaptiveMinDispatchPercent')) / 100,
                        cleanCooldownMin: value('cleanCooldownMin'), fullCooldownMin: value('fullCooldownMin'),
                        lossCooldownMin: value('lossCooldownMin')
                    });
                }
            } catch (error) {
                diagnostic(scope, 'UI_ERROR', error.message, { code: error.code || '' });
            }
        });
        render(scope);
    }

    async function render(scopeInput = null) {
        const panel = root.document?.getElementById?.(panelId());
        if (!panel) return;
        let scope;
        try { scope = currentScope(scopeInput?.sourceVillageId); } catch (_) { return; }
        if (panel.dataset.scope !== scopeKey(scope)) return;
        try {
            const records = await ensureNativeRecords(scope);
            const settings = core().normalizeCfg(records.settings.value);
            const state = core().normalizeCoordinationState(records.coordination.value);
            const descriptor = scheduler()?.describe?.(taskKey(scope));
            const model = await loadModel(scope);
            const set = (name, value) => { const element = panel.querySelector(`[data-field="${name}"]`); if (element && root.document.activeElement !== element) element.value = value; };
            set('farmTemplate', settings.farmTemplate); set('radius', settings.radius);
            set('maxSendsPerPass', settings.maxSendsPerPass); set('retrySeconds', settings.retrySeconds);
            set('attemptGapSeconds', Number(settings.attemptGapMs / 1000).toFixed(1));
            set('adaptiveEnabled', String(settings.adaptiveEnabled));
            set('stochasticSchedulingMode', settings.stochasticSchedulingMode);
            set('adaptiveHistoryDays', settings.adaptiveHistoryDays);
            set('adaptiveReportFetchPerPass', settings.adaptiveReportFetchPerPass);
            set('adaptiveMaxUnseenHours', settings.adaptiveMaxUnseenHours);
            set('adaptiveRevisitFillPercent', Math.round(settings.adaptiveRevisitFillThreshold * 100));
            set('adaptiveMinDispatchPercent', Math.round(settings.adaptiveMinDispatchEfficiency * 100));
            set('cleanCooldownMin', settings.cleanCooldownMin);
            set('fullCooldownMin', settings.fullCooldownMin);
            set('lossCooldownMin', settings.lossCooldownMin);
            const button = panel.querySelector('[data-action="toggle"]');
            if (button) button.textContent = settings.enabled ? 'PARAR' : 'INICIAR';
            const status = panel.querySelector('[data-role="status"]');
            if (status) status.textContent = `${settings.enabled ? 'ATIVO' : 'PARADO'} · ${state.state} · ` +
                `wake ${descriptor?.state || 'MISSING'}${descriptor?.dueAt ? ` às ${new Date(descriptor.dueAt).toLocaleTimeString()}` : ''} · ` +
                `ronda ${state.executionRound?.dispatchLimitRemaining ?? '—'} · ${state.reason || '—'}`;
            const targetStates = records.targets?.value || {};
            const targetCount = Number(state.sources.MAP?.data?.targetIds && Object.keys(state.sources.MAP.data.targetIds).length) ||
                Object.keys(model.farms || {}).length;
            const pendingCount = Object.values(targetStates).filter(value => value?.pending || value?.sending).length;
            const capacity = core().normalizeCapacityProof(state.sources.CAPACITY?.data);
            const roleText = (role, value) => { const element = panel.querySelector(`[data-role="${role}"]`); if (element) element.textContent = String(value); };
            roleText('targets', targetCount); roleText('pending', pendingCount);
            roleText('reports', model.reportLedger.length); roleText('capacity', capacity.value ?? '—');
            const farms = Object.entries(model.farms || {}).map(([coord, value]) =>
                core().normalizeAdaptiveFarm(value, coord, value?.distance));
            const learned = farms.filter(farm => Number(farm.observations || 0) > 0);
            const modelSummary = panel.querySelector('[data-role="model-summary"]');
            if (modelSummary) modelSummary.textContent = `${learned.length}/${farms.length} farms com observações · ` +
                `${model.reportLedger.filter(report => report.quantitative).length} reports quantitativos · ` +
                `${model.dispatches.filter(dispatch => dispatch.status === 'MATCHED' || dispatch.status === 'LATE_MATCHED').length}/${model.dispatches.length} dispatches correlacionados.`;
            const ranking = panel.querySelector('[data-role="ranking"]');
            if (ranking) {
                const top = farms.sort((a, b) => Number(b.farmRating || 0) - Number(a.farmRating || 0)).slice(0, 10);
                ranking.innerHTML = top.length ? top.map(farm => `<tr><td>${farm.coord}</td><td>${Number(farm.farmRating || 0).toFixed(0)}</td><td>${Math.round(Number(farm.certainty || 0) * 100)}%</td><td>${Number(farm.nextDueAt) > 0 ? new Date(farm.nextDueAt).toLocaleTimeString() : '—'}</td></tr>`).join('') : '<tr><td colspan="4">Sem farms.</td></tr>';
            }
            const logs = panel.querySelector('[data-role="logs"]');
            if (logs) logs.textContent = (runtime.diagnostics.get(scopeKey(scope)) || []).slice(-40)
                .map(item => `[${new Date(item.at).toLocaleTimeString()}] ${item.status} · ${item.reason}`).join('\n') || 'Sem eventos nesta página.';
        } catch (error) {
            const status = panel.querySelector('[data-role="status"]');
            if (status) status.textContent = `ERRO FAIL-CLOSED · ${error.message}`;
        }
    }

    async function init() {
        const service = scheduler();
        if (!service?.registerHandler) return false;
        if (!runtime.registered) {
            service.registerHandler(HANDLER, (args, guard) => runOccurrence(args?.[0] || {}, args?.[1], guard));
            runtime.registered = true;
        }
        if (!featureAllowed()) return false;
        let scope;
        try { scope = currentScope(); } catch (_) { return false; }
        const records = await ensureNativeRecords(scope);
        installPanel(scope);
        const settings = core().normalizeCfg(records.settings.value);
        if (!settings.enabled) {
            service.cancel?.(taskKey(scope), 'disabled');
            render(scope);
            return true;
        }
        if (hardStopped()) {
            if (!service.hasTask?.(taskKey(scope))) {
                schedule(scope, now() + settings.retrySeconds * 1000, 'OBSERVATION');
            }
            render(scope);
            return true;
        }
        if (service.hasTask?.(taskKey(scope))) {
            diagnostic(scope, 'BOOT_RESTORED', 'persisted scheduler task reused; 0 GET / 0 POST');
            render(scope);
            return true;
        }
        const unresolved = await unresolvedMutations(scope);
        if (unresolved.length) {
            schedule(scope, now(), 'RECONCILIATION', service.PRIORITY?.RECONCILIATION);
        } else {
            const state = core().normalizeCoordinationState(records.coordination.value);
            const dueAt = state.state === 'WAITING_EXECUTION' && Number(state.executionDueAt) > 0
                ? Math.max(now(), Number(state.executionDueAt))
                : now() + settings.retrySeconds * 1000;
            schedule(scope, dueAt, state.state === 'WAITING_EXECUTION' ? 'EXECUTION' : 'OBSERVATION');
        }
        render(scope);
        return true;
    }

    root.PremiumFeaturesAutoFarmAdaptive = Object.freeze({
        VERSION, HANDLER, init, render, currentScope, setEnabled, updateSettings,
        runOccurrence, observationOccurrence, executeOccurrence, reconcileOccurrence,
        parseWorldMap, reportIsSafelyNewer,
        _test: { runtime, featureAllowed, targetStateBlocked, historicalEvidence, finalCandidateAllowed }
    });
})(window);

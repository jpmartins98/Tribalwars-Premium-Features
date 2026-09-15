// ==UserScript==
// @name         Tribalwars: Premium Features [Premium Compat]
// @version      5.3.2
// @description  Feature-rich enhancement suite for TribalWars. Widgets: Village List, Notepad, Extra Build Queue, Recruit Troops. Map: hover details, outgoing command overlay, attack heat-map, custom CTX attack template buttons, large map view. Automation: Auto Daily Bonus collection. UI: Custom Navigation Bar, Navigation Arrows, Visual Building Overview. Settings: full import/export support.
// @author       killwilll
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/i18n_utils.js?v=5.3.2
// @resource     i18n_en      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/en.json
// @resource     i18n_pt      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/pt.json
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/emojiMap.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_storage.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_runtime.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_diagnostics.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_coordination.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_state.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_utils.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_widgets.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_time.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_async.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_scheduler.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/mapDataCache.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/bbcode.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/worldGameData.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/buildingsData.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/attackLauncher.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/nativeMemo.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_indexeddb.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/buildStateStore.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/resourcesManager.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/buildingsManager.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/marketTransports.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_bot_protection.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_css.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_darkmode.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_sidebar.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_settings.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/mapSdk.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/ctxCustom.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageArrows.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/navigationBar.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/reportsManager.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapHeatOverlay.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/map.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/allyReservations.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapGroups.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapGroupQuickLinks.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overview.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/init.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/productionTable.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/troopsTable.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/marketTable.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/manualGroups.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/navigationMenu.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/quickLinks.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/troopTemplates.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/farmAssistant.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/simulator.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/playerProfile.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/villageProfile.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/extraNotepad.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/trainerPaladin.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/scavenging.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/dailyBonus.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/buildInstantFree.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageList.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/notepad.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/extraBuildQueue.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/recruitTroops.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageGroups.js?v=5.3.2
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/coinMinting.js?v=5.3.2
// @include      https://*.tribalwars.*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @connect      twstats.com
// ==/UserScript==
(function () {
    'use strict';

    const runtime = window.PremiumFeaturesRuntimeRegistry;

    function isBotProtectionActive() {
        return Boolean(window.PremiumFeaturesBotProtection && window.PremiumFeaturesBotProtection.isActive());
    }

    if (isBotProtectionActive()) {
        return;
    }

    $(document)
        .off('partial_reload_end.premium_features')
        .on('partial_reload_end.premium_features', function () {
            if (!isBotProtectionActive() && !document.getElementById('mobileContent')) {
                runtime.requestReconcile('partial-reload', function () {
                    init().then(start).catch(function (error) {
                        console.error('[TW] Partial reload reconcile failed', error);
                    });
                });
            }
        });

    var villageList;
    function init() {
        return runtime.onceAsync('core:boot', async function () {
            if (isBotProtectionActive()) return;
            await hydrateBuildQueueCache();
            cleanupLegacyRecruitQueueLocalStorage();
            cleanupLegacyReportsLocalStorage();
            await cleanupLegacyNotepadStorage();
            await hydrateNotepadCache();
            await hydrateVillageProfileNotesCache();
            await hydrateReservationsCache();
            cleanupLegacyMapDataLocalStorage();
            await hydrateMapDataCache();
            restoreTimeouts();
            prepareLocalStorageItems();
            runtime.installInteractionTracking(document);
            window.PremiumFeaturesCoordination?.start?.();
            window.PremiumFeaturesBackgroundScheduler?.start?.();
        });
    }

    runtime.setTimeout('core:boot-delay', () => {
        if (!isBotProtectionActive()) {
            init().then(function () {
                if (!document.getElementById('mobileContent')) start();
            }).catch(function (error) {
                console.error('[TW] Boot failed', error);
            });
        }
    }, 500, false);
})();

// ==UserScript==
// @name         Tribalwars: Premium Features [Premium Compat]
// @version      5.0.4.2
// @description  Feature-rich enhancement suite for TribalWars. Widgets: Village List, Notepad, Extra Build Queue, Recruit Troops. Map: hover details, outgoing command overlay, attack heat-map, custom CTX attack template buttons, large map view. Automation: Auto Daily Bonus collection. UI: Custom Navigation Bar, Navigation Arrows, Visual Building Overview. Settings: full import/export support.
// @author       killwilll
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/i18n_utils.js
// @resource     i18n_en      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/en.json
// @resource     i18n_pt      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/i18n/pt.json
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/emojiMap.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_storage.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_state.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_utils.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_widgets.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_time.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_async.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_scheduler.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/mapDataCache.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/bbcode.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/worldGameData.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/buildingsData.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/attackLauncher.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/nativeMemo.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_indexeddb.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/resourcesManager.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/buildingsManager.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/marketTransports.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_bot_protection.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_css.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_darkmode.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_sidebar.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/core_settings.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/mapSdk.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/ctxCustom.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageArrows.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/navigationBar.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/utils/reportsManager.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapHeatOverlay.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/map.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/allyReservations.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapGroups.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/map/mapGroupQuickLinks.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overview.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/init.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/productionTable.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/troopsTable.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/marketTable.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/manualGroups.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/navigationMenu.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/overviewVillages/quickLinks.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/troopTemplates.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/farmAssistant.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/simulator.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/playerProfile.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/villageProfile.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/features/extraNotepad.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/trainerPaladin.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/scavenging.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/dailyBonus.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/bots/buildInstantFree.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageList.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/notepad.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/extraBuildQueue.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/recruitTroops.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/villageGroups.js
// @require      https://raw.githubusercontent.com/jpmartins98/Tribalwars-Premium-Features/master/widgets/coinMinting.js
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
                start();
            }
        });

    var villageList;
    async function init() {
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
        if (!document.getElementById('mobileContent')) {
            start();
        }
    }

    setTimeout(() => {
        if (!isBotProtectionActive()) {
            init();
        }
    }, 500);
})();

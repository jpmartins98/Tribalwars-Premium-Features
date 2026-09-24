const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'utils', 'core_bot_protection.js'),
  'utf8'
);

function makeContext({ hardStopped = true, markers = false } = {}) {
  const scheduler = {
    hardStopCalls: [],
    stats() { return { hardStopped }; },
    hardStop(reason) { this.hardStopCalls.push(reason); },
    clearHardStop() { hardStopped = false; return true; },
    restorePersistedTasks() {}
  };

  const document = {
    body: {},
    querySelector(selector) {
      if (!markers) return null;
      return selector === 'td.bot-protection-row' || selector === '.captcha' ? {} : null;
    },
    getElementById(id) {
      return markers && id === 'botprotection_quest' ? {} : null;
    },
    addEventListener() {}
  };

  function MutationObserver() {
    this.observe = () => {};
    this.disconnect = () => {};
  }

  const window = {
    PremiumFeaturesBackgroundScheduler: scheduler,
    PremiumFeaturesCoordination: {
      scope: 'test',
      instanceId: 'tab-a',
      start() {}, stop() {}, broadcast() {}, subscribe() {}
    },
    PremiumFeaturesRuntimeRegistry: { addEventListener() {} },
    PremiumFeaturesDiagnostics: { record() {} },
    MutationObserver,
    game_data: { world: 'pt117', player: { id: 1 } },
    addEventListener() {},
    refreshHardStopRecoveryControl() {}
  };

  const context = {
    window,
    document,
    location: { hostname: 'pt117.tribalwars.com.pt' },
    localStorage: { setItem() {} },
    console,
    setInterval() { return 1; },
    clearInterval() {},
    MutationObserver,
    getSetting() { return true; },
    $() { return { off() {} }; }
  };
  window.localStorage = context.localStorage;
  context.globalThis = context;
  return { context, scheduler };
}

{
  const { context } = makeContext({ hardStopped: true, markers: false });
  vm.runInNewContext(source, context, { filename: 'core_bot_protection.js' });
  assert.strictEqual(
    context.window.PremiumFeaturesBotProtection.isActive(),
    false,
    'persisted scheduler HARD_STOP must not masquerade as current Bot Protection'
  );
  assert.strictEqual(
    context.window.PremiumFeaturesBotProtection.canResumeAfterHardStop(),
    true,
    'persisted HARD_STOP without current markers must remain manually recoverable'
  );
}

{
  const { context } = makeContext({ hardStopped: true, markers: true });
  vm.runInNewContext(source, context, { filename: 'core_bot_protection.js' });
  assert.strictEqual(
    context.window.PremiumFeaturesBotProtection.isActive(),
    true,
    'current protection markers must still activate Bot Protection fail-closed'
  );
}

console.log('PASS bot_protection_persisted_hardstop_harness');

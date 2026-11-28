import { createWidgetDataClient } from '../shared/data-client.ts';
import {
  extensionApi,
  sendingRuntime,
  storageArea,
  watchStorageKey,
} from '../shared/extension-api.ts';
import { createRequestSender } from '../shared/messages.ts';
import { createAreaStore, STORAGE_KEYS } from '../shared/storage.ts';
import { defaultTweaks, parseTweaks } from '../shared/tweaks.ts';
import { createDefaultLayout, DASHBOARD_WIDGETS } from './dashboard-widgets.ts';
import { createFileIcons } from './file-icons/file-icons.ts';
import { createHeaderPins } from './header-pins/header-pins.ts';
import { createDashboardHost } from './host/dashboard-host.ts';
import type { DashboardHost } from './host/dashboard-host.ts';
import { createMountController } from './mount/mount-controller.ts';
import { pageLogin } from './mount/selectors.ts';
import { whenPageSettled } from './page-settled.ts';
import { createQuickSwitcher } from './quick-switcher/quick-switcher.ts';
import { applyTweaks } from './tweaks/apply-tweaks.ts';
import { createChangelogHider } from './tweaks/changelog-hider.ts';

const api = extensionApi();
const send = createRequestSender(sendingRuntime(api));
const data = createWidgetDataClient(send);
const syncStore = createAreaStore(storageArea(api, 'sync'));
const openOptions = (): void => {
  void send('extension.openOptions', {});
};

let host: DashboardHost | null = null;

const controller = createMountController({
  document,
  window,
  onEnter(root) {
    host = createDashboardHost({
      root,
      widgets: DASHBOARD_WIDGETS,
      data,
      layoutStore: syncStore,
      defaultLayout: () => createDefaultLayout(),
      loadTokens: () => send('tokens.summary', {}),
      pageLogin: pageLogin(document),
      openOptions,
      onViewChange(view) {
        if (view === 'original') {
          controller.showOriginal();
        } else {
          controller.showDashboard();
        }
      },
      reportError: (error) => console.warn('[GitHub UI Enhancer]', error),
    });
  },
  onLeave() {
    host?.dispose();
    host = null;
  },
});

// Started right away so GitHub's page stays hidden while the tweaks load; a disabled
// dashboard is stopped again a few milliseconds later.
controller.start();

// Pins and file icons go into parts GitHub prerenders and React takes over later.
const settled = whenPageSettled(document, window);

const targets = {
  dashboard: controller,
  changelogHider: createChangelogHider({ document, window }),
  headerPins: createHeaderPins({
    document,
    window,
    data,
    store: syncStore,
    subscribe: (listener) => watchStorageKey(api, 'sync', STORAGE_KEYS.headerPins, listener),
    settled,
  }),
  fileIcons: createFileIcons({ document, window, settled }),
  quickSwitcher: createQuickSwitcher({ document, window, data, openOptions }),
};
syncStore.get(STORAGE_KEYS.tweaks).then(
  (raw) => applyTweaks(parseTweaks(raw), targets),
  () => applyTweaks(defaultTweaks(), targets),
);
watchStorageKey(api, 'sync', STORAGE_KEYS.tweaks, (raw) => applyTweaks(parseTweaks(raw), targets));

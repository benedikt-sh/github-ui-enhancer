import { createWidgetDataClient } from '../shared/data-client.ts';
import { extensionApi, sendingRuntime, storageArea } from '../shared/extension-api.ts';
import { createRequestSender } from '../shared/messages.ts';
import { createAreaStore } from '../shared/storage.ts';
import { createDefaultLayout, DASHBOARD_WIDGETS } from './dashboard-widgets.ts';
import { createDashboardHost } from './host/dashboard-host.ts';
import type { DashboardHost } from './host/dashboard-host.ts';
import { createMountController } from './mount/mount-controller.ts';
import { pageLogin } from './mount/selectors.ts';

const api = extensionApi();
const send = createRequestSender(sendingRuntime(api));
const data = createWidgetDataClient(send);
const layoutStore = createAreaStore(storageArea(api, 'sync'));
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
      layoutStore,
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

controller.start();

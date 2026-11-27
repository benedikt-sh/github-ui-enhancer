import { extensionApi, sendingRuntime, storageArea } from '../shared/extension-api.ts';
import { createRequestSender } from '../shared/messages.ts';
import { createAreaStore } from '../shared/storage.ts';
import { renderOptionsPage } from './options-page.ts';

const root = document.getElementById('ghx-options');
if (root) {
  const api = extensionApi();
  renderOptionsPage(root, {
    send: createRequestSender(sendingRuntime(api)),
    settingsStore: createAreaStore(storageArea(api, 'sync')),
  });
}

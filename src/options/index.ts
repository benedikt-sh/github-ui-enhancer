import { extensionApi, sendingRuntime } from '../shared/extension-api.ts';
import { createRequestSender } from '../shared/messages.ts';
import { renderOptionsPage } from './options-page.ts';

const root = document.getElementById('ghx-options');
if (root) {
  renderOptionsPage(root, { send: createRequestSender(sendingRuntime(extensionApi())) });
}

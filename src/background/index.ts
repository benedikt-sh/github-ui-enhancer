import {
  addMessageListener,
  extensionApi,
  extensionOrigin,
  storageArea,
} from '../shared/extension-api.ts';
import { createMessageListener } from '../shared/messages.ts';
import { createAreaStore } from '../shared/storage.ts';
import { createCache } from './cache/cache.ts';
import { createRequestHandlers } from './data/request-handlers.ts';
import { createTokenProbe } from './data/token-probe.ts';
import { createDataLayer } from './data/widget-data.ts';
import { createGitHubClient } from './github/client.ts';
import { createTokenRegistry } from './tokens/token-registry.ts';

const api = extensionApi();
const localStore = createAreaStore(storageArea(api, 'local'));
const client = createGitHubClient({ fetch });
const cache = createCache({ store: localStore, now: Date.now });
const registry = createTokenRegistry({ store: localStore, probe: createTokenProbe(client) });
const data = createDataLayer({ client, cache, registry });
const handlers = createRequestHandlers({
  data,
  registry,
  openOptionsPage: () => api.runtime.openOptionsPage(),
});

addMessageListener(
  api,
  createMessageListener(handlers, { extensionOrigin: extensionOrigin(api) }),
);

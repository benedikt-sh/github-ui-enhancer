import type {
  MessageListener,
  MessageSenderLike,
  SendingRuntime,
} from '../../src/shared/messages.ts';

export const EXTENSION_ORIGIN = 'chrome-extension://fake-extension-id/';
export const CONTENT_URL = 'https://github.com/';

export interface FakeMessaging {
  readonly extensionOrigin: string;
  /** Runtime as seen from the content script on github.com. */
  readonly content: SendingRuntime;
  /** Runtime as seen from an extension page such as the options page. */
  readonly extensionPage: SendingRuntime;
  sendFrom(sender: MessageSenderLike, message: unknown): Promise<unknown>;
  addListener(listener: MessageListener): void;
  removeListener(listener: MessageListener): void;
}

/**
 * Mimics `runtime.sendMessage`: rejects without listeners, resolves with the first response
 * and resolves `undefined` when no listener keeps the channel open.
 */
export function createFakeMessaging(): FakeMessaging {
  const listeners = new Set<MessageListener>();

  const sendFrom = (sender: MessageSenderLike, message: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (listeners.size === 0) {
        reject(new Error('Could not establish connection. Receiving end does not exist.'));
        return;
      }
      let answered = false;
      let keepOpen = false;
      const sendResponse = (response: unknown): void => {
        if (!answered) {
          answered = true;
          resolve(structuredClone(response));
        }
      };
      for (const listener of listeners) {
        keepOpen = listener(structuredClone(message), sender, sendResponse) || keepOpen;
      }
      if (!answered && !keepOpen) {
        resolve(undefined);
      }
    });

  return {
    extensionOrigin: EXTENSION_ORIGIN,
    content: { sendMessage: (message) => sendFrom({ url: CONTENT_URL }, message) },
    extensionPage: {
      sendMessage: (message) => sendFrom({ url: `${EXTENSION_ORIGIN}options.html` }, message),
    },
    sendFrom,
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
  };
}

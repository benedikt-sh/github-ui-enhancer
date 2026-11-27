import type {
  DataResult,
  ListOptions,
  RecentRepositoryOptions,
  RequestOptions,
  WorkflowRunOptions,
} from './data.ts';
import { ApiError, isApiErrorInfo, toApiErrorInfo } from './errors.ts';
import type { ApiErrorInfo } from './errors.ts';
import { isRecord, isString } from './guards.ts';
import type { TokenInfo } from './tokens.ts';
import type {
  BranchItem,
  IssueItem,
  PullRequestItem,
  RecentRepoItem,
  RepoRef,
  RepoSummary,
  WorkflowRunItem,
} from './types.ts';

/**
 * Every request the background context answers. `scope: 'extension'` operations are refused
 * for content scripts, so code running on github.com can never manage tokens.
 */
export interface RequestMap {
  'data.repoIndex': {
    scope: 'content';
    params: { options?: RequestOptions };
    result: DataResult<RepoSummary[]>;
  };
  'data.searchPullRequests': {
    scope: 'content';
    params: { query: string; options?: ListOptions };
    result: DataResult<PullRequestItem[]>;
  };
  'data.searchIssues': {
    scope: 'content';
    params: { query: string; options?: ListOptions };
    result: DataResult<IssueItem[]>;
  };
  'data.subscribedIssues': {
    scope: 'content';
    params: { options?: ListOptions };
    result: DataResult<IssueItem[]>;
  };
  'data.workflowRuns': {
    scope: 'content';
    params: { repo: RepoRef; options?: WorkflowRunOptions };
    result: DataResult<WorkflowRunItem[]>;
  };
  'data.branches': {
    scope: 'content';
    params: { repo: RepoRef; options?: RequestOptions };
    result: DataResult<BranchItem[]>;
  };
  'data.recentRepositories': {
    scope: 'content';
    params: { options?: RecentRepositoryOptions };
    result: DataResult<RecentRepoItem[]>;
  };
  'tokens.summary': { scope: 'content'; params: Record<string, never>; result: TokenInfo[] };
  'extension.openOptions': { scope: 'content'; params: Record<string, never>; result: null };
  'tokens.list': { scope: 'extension'; params: Record<string, never>; result: TokenInfo[] };
  'tokens.add': {
    scope: 'extension';
    params: { secret: string; owner?: string };
    result: TokenInfo;
  };
  'tokens.remove': { scope: 'extension'; params: { id: string }; result: null };
  'tokens.validate': { scope: 'extension'; params: { id: string }; result: TokenInfo };
  'tokens.setOwner': {
    scope: 'extension';
    params: { id: string; owner: string | null };
    result: TokenInfo;
  };
  'cache.clear': { scope: 'extension'; params: Record<string, never>; result: null };
}

export type Operation = keyof RequestMap;
export type Params<K extends Operation> = RequestMap[K]['params'];
export type Result<K extends Operation> = RequestMap[K]['result'];

export const OPERATION_SCOPES: { readonly [K in Operation]: RequestMap[K]['scope'] } = {
  'data.repoIndex': 'content',
  'data.searchPullRequests': 'content',
  'data.searchIssues': 'content',
  'data.subscribedIssues': 'content',
  'data.workflowRuns': 'content',
  'data.branches': 'content',
  'data.recentRepositories': 'content',
  'tokens.summary': 'content',
  'extension.openOptions': 'content',
  'tokens.list': 'extension',
  'tokens.add': 'extension',
  'tokens.remove': 'extension',
  'tokens.validate': 'extension',
  'tokens.setOwner': 'extension',
  'cache.clear': 'extension',
};

const CHANNEL = 'ghx';

export interface RequestMessage<K extends Operation = Operation> {
  readonly channel: typeof CHANNEL;
  readonly op: K;
  readonly params: Params<K>;
}

export type ResponseMessage<K extends Operation = Operation> =
  | { readonly ok: true; readonly result: Result<K> }
  | { readonly ok: false; readonly error: ApiErrorInfo };

export function isOperation(value: unknown): value is Operation {
  return isString(value) && Object.hasOwn(OPERATION_SCOPES, value);
}

export function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    isRecord(value) &&
    value['channel'] === CHANNEL &&
    isOperation(value['op']) &&
    isRecord(value['params'])
  );
}

export interface MessageSenderLike {
  readonly url?: string | undefined;
}

export interface SendingRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

export type RequestSender = <K extends Operation>(op: K, params: Params<K>) => Promise<Result<K>>;

/** Rejects with `ApiError` if the background answers with an error or not at all. */
export function createRequestSender(runtime: SendingRuntime): RequestSender {
  return async <K extends Operation>(op: K, params: Params<K>): Promise<Result<K>> => {
    const message: RequestMessage<K> = { channel: CHANNEL, op, params };
    let response: unknown;
    try {
      response = await runtime.sendMessage(message);
    } catch (error) {
      throw new ApiError({ kind: 'internal', message: toApiErrorInfo(error).message });
    }
    if (!isRecord(response) || typeof response['ok'] !== 'boolean') {
      throw new ApiError({ kind: 'internal', message: `No valid response for "${op}".` });
    }
    if (response['ok']) {
      return response['result'] as Result<K>;
    }
    const error = response['error'];
    throw new ApiError(
      isApiErrorInfo(error) ? error : { kind: 'internal', message: `Request "${op}" failed.` },
    );
  };
}

export type RequestHandlers = {
  readonly [K in Operation]: (params: Params<K>, sender: MessageSenderLike) => Promise<Result<K>>;
};

export type MessageListener = (
  message: unknown,
  sender: MessageSenderLike,
  sendResponse: (response: ResponseMessage) => void,
) => boolean;

export interface ListenerOptions {
  /** Origin of extension pages, e.g. `chrome-extension://<id>/`. */
  readonly extensionOrigin: string;
}

/**
 * Builds the `runtime.onMessage` listener for the background context. Messages from other
 * channels are ignored (returns false) so other listeners can still answer them.
 */
export function createMessageListener(
  handlers: RequestHandlers,
  { extensionOrigin }: ListenerOptions,
): MessageListener {
  return (message, sender, sendResponse) => {
    if (!isRecord(message) || message['channel'] !== CHANNEL) {
      return false;
    }
    if (!isRequestMessage(message)) {
      sendResponse({
        ok: false,
        error: { kind: 'invalid_request', message: 'Malformed request.' },
      });
      return false;
    }
    const { op, params } = message;
    const fromExtensionPage = sender.url?.startsWith(extensionOrigin) === true;
    if (OPERATION_SCOPES[op] === 'extension' && !fromExtensionPage) {
      sendResponse({
        ok: false,
        error: { kind: 'not_allowed', message: `"${op}" is only available to extension pages.` },
      });
      return false;
    }
    const handler = handlers[op] as (
      params: Params<Operation>,
      sender: MessageSenderLike,
    ) => Promise<Result<Operation>>;
    handler(params, sender).then(
      (result) => sendResponse({ ok: true, result }),
      (error: unknown) => sendResponse({ ok: false, error: toApiErrorInfo(error) }),
    );
    // Keeps the message channel open until the asynchronous sendResponse call.
    return true;
  };
}

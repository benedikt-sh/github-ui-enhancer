export interface FakeResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /** Objects and arrays are sent as JSON, strings as is, undefined as empty body. */
  readonly body?: unknown;
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string | null;
}

type Matcher = string | RegExp | ((request: RecordedRequest) => boolean);
type Responder = FakeResponse | ((request: RecordedRequest) => FakeResponse | Promise<FakeResponse>);

export interface FetchFake {
  readonly fetch: typeof fetch;
  readonly requests: readonly RecordedRequest[];
  /** Answers every matching request. Later routes take precedence over earlier ones. */
  on(matcher: Matcher, responder: Responder): FetchFake;
  /** Answers only the next matching request, takes precedence over `on` routes. */
  once(matcher: Matcher, responder: Responder): FetchFake;
  /** Makes matching requests fail like a network error (`TypeError`). */
  failNetwork(matcher: Matcher): FetchFake;
}

interface Route {
  readonly matches: (request: RecordedRequest) => boolean;
  readonly respond: (request: RecordedRequest) => Promise<FakeResponse>;
  readonly once: boolean;
}

export function createFetchFake(): FetchFake {
  const requests: RecordedRequest[] = [];
  const routes: Route[] = [];

  const toMatch = (matcher: Matcher) => (request: RecordedRequest) => {
    if (typeof matcher === 'string') {
      return request.url === matcher || request.url.startsWith(`${matcher}?`);
    }
    if (matcher instanceof RegExp) {
      return matcher.test(request.url);
    }
    return matcher(request);
  };
  const toRespond = (responder: Responder) => async (request: RecordedRequest) =>
    typeof responder === 'function' ? responder(request) : responder;

  const fake: FetchFake = {
    requests,
    async fetch(input, init) {
      const request = new Request(input, init);
      const recorded: RecordedRequest = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body === null ? null : await request.text(),
      };
      requests.push(recorded);

      const onceIndex = routes.findIndex((route) => route.once && route.matches(recorded));
      const route =
        onceIndex >= 0
          ? routes.splice(onceIndex, 1)[0]
          : routes.findLast((candidate) => !candidate.once && candidate.matches(recorded));
      if (route === undefined) {
        throw new Error(`Unexpected request: ${recorded.method} ${recorded.url}`);
      }
      return toResponse(await route.respond(recorded));
    },
    on(matcher, responder) {
      routes.push({ matches: toMatch(matcher), respond: toRespond(responder), once: false });
      return fake;
    },
    once(matcher, responder) {
      routes.push({ matches: toMatch(matcher), respond: toRespond(responder), once: true });
      return fake;
    },
    failNetwork(matcher) {
      routes.push({
        matches: toMatch(matcher),
        respond: () => Promise.reject(new TypeError('Failed to fetch')),
        once: false,
      });
      return fake;
    },
  };
  return fake;
}

function toResponse({ status = 200, headers = {}, body }: FakeResponse): Response {
  const isJson = body !== undefined && typeof body !== 'string';
  const allHeaders = new Headers(headers);
  if (isJson && !allHeaders.has('content-type')) {
    allHeaders.set('content-type', 'application/json; charset=utf-8');
  }
  const payload = body === undefined || status === 204 || status === 304 ? null : body;
  return new Response(isJson && payload !== null ? JSON.stringify(payload) : (payload as string | null), {
    status,
    headers: allHeaders,
  });
}

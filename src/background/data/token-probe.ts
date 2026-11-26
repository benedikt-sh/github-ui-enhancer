import { ApiError } from '../../shared/errors.ts';
import { isNonEmptyString, isRecord } from '../../shared/guards.ts';
import { sameOwner } from '../../shared/repo.ts';
import type { GitHubClient, RestResult } from '../github/types.ts';
import type { TokenProbe } from '../tokens/token-probe.ts';

function invalidResponse(message: string): ApiError {
  return new ApiError({ kind: 'invalid_response', message });
}

function okData(result: RestResult, request: string): unknown {
  // Unconditional requests never come back as "not modified", the client rejects those.
  if (result.kind !== 'ok') {
    throw invalidResponse(`GitHub ${request} answered "not modified" unexpectedly`);
  }
  return result.data;
}

function ownerLogin(repo: unknown): string | null {
  if (!isRecord(repo)) {
    return null;
  }
  const owner = repo['owner'];
  return isRecord(owner) && isNonEmptyString(owner['login']) ? owner['login'] : null;
}

export function createTokenProbe(client: GitHubClient): TokenProbe {
  return {
    async inspect(secret) {
      const result = await client.restGet(secret, '/user');
      const user = okData(result, 'GET /user');
      if (!isRecord(user) || !isNonEmptyString(user['login'])) {
        throw invalidResponse('GitHub GET /user returned no login');
      }
      return { login: user['login'], expiresAt: result.meta.tokenExpiresAt };
    },

    async repositoryOwners(secret) {
      const result = await client.restGet(secret, '/user/repos', { query: { per_page: 100 } });
      const repos = okData(result, 'GET /user/repos');
      if (!Array.isArray(repos)) {
        throw invalidResponse('GitHub GET /user/repos did not return a list');
      }
      const owners: string[] = [];
      for (const login of repos.map(ownerLogin)) {
        if (login !== null && !owners.some((known) => sameOwner(known, login))) {
          owners.push(login);
        }
      }
      return owners;
    },
  };
}

import { ApiError } from '../../shared/errors.ts';

const FINE_GRAINED = /^github_pat_[A-Za-z0-9_]+$/;
// Classic tokens either carry the `ghp_` prefix or, if created before 2021, are 40 hex digits.
const CLASSIC = /^(?:ghp_|[0-9a-f]{40}$)/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

function invalid(message: string): ApiError {
  return new ApiError({ kind: 'invalid_request', message });
}

/**
 * Trims the input and accepts only fine-grained personal access tokens. Error messages never
 * contain the input, because it is a secret.
 */
export function normalizeSecret(input: string): string {
  const secret = input.trim();
  if (secret === '') {
    throw invalid('The token is empty.');
  }
  if (CLASSIC.test(secret)) {
    throw invalid(
      'Classic personal access tokens are not supported because they always grant write ' +
        'access. Create a fine-grained token with read-only permissions instead.',
    );
  }
  if (!FINE_GRAINED.test(secret)) {
    throw invalid(
      'This is not a fine-grained personal access token. Fine-grained tokens start with ' +
        '"github_pat_".',
    );
  }
  return secret;
}

/** Returns null for blank input, which means the owner should be detected. */
export function normalizeOwner(input: string | null | undefined): string | null {
  const owner = input?.trim() ?? '';
  if (owner === '') {
    return null;
  }
  if (!OWNER.test(owner)) {
    throw invalid(`"${owner}" is not a valid GitHub account or organization name.`);
  }
  return owner;
}

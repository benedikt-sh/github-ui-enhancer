export interface TokenIdentity {
  readonly login: string;
  /** ISO timestamp, null for tokens without expiration. */
  readonly expiresAt: string | null;
}

/**
 * What the registry needs from the GitHub client. Implementations reject with `ApiError`.
 */
export interface TokenProbe {
  /**
   * Calls `GET /user` with the token. The expiration comes from the response header
   * `github-authentication-token-expiration`.
   */
  inspect(secret: string): Promise<TokenIdentity>;
  /** Owners of the repositories the token can see. The first page of `GET /user/repos` suffices. */
  repositoryOwners(secret: string): Promise<string[]>;
}

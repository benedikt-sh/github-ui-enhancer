export interface ReleaseVersion {
  /** Numeric `major.minor.patch`, the only format browsers accept as manifest version. */
  readonly version: string;
  /** Full semver including prerelease and build parts, e.g. `1.2.0-beta.1`. */
  readonly semver: string;
  readonly prerelease: boolean;
}

const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Chrome rejects manifest version parts above this value. */
const MAX_PART = 65535;

/** Accepts `1.2.3` or a release tag like `v1.2.3-rc.1`, throws for anything else. */
export function parseReleaseVersion(input: string): ReleaseVersion {
  const match = SEMVER.exec(input.trim());
  if (match === null) {
    throw new Error(`"${input}" is not a semantic version like v1.2.3.`);
  }
  const [, major = '', minor = '', patch = '', prerelease] = match;
  const parts = [major, minor, patch];
  if (parts.some((part) => Number(part) > MAX_PART)) {
    throw new Error(`"${input}" has a version part above ${MAX_PART}.`);
  }
  return {
    version: parts.join('.'),
    semver: input.trim().replace(/^v/, ''),
    prerelease: prerelease !== undefined,
  };
}

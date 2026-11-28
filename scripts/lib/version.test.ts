import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseReleaseVersion } from './version.ts';

describe('parseReleaseVersion', () => {
  it('accepts plain versions and release tags', () => {
    assert.deepEqual(parseReleaseVersion('1.2.3'), {
      version: '1.2.3',
      semver: '1.2.3',
      prerelease: false,
    });
    assert.deepEqual(parseReleaseVersion(' v0.10.0 '), {
      version: '0.10.0',
      semver: '0.10.0',
      prerelease: false,
    });
  });

  it('keeps prerelease and build parts out of the manifest version', () => {
    assert.deepEqual(parseReleaseVersion('v2.0.0-rc.1+build.5'), {
      version: '2.0.0',
      semver: '2.0.0-rc.1+build.5',
      prerelease: true,
    });
    assert.equal(parseReleaseVersion('v1.0.0+exp.sha.5114f85').prerelease, false);
  });

  it('rejects anything that is not semver', () => {
    const invalid = ['', 'v1.2', '1.2.3.4', 'v01.2.3', 'release-1.2.3', '1.2.3-', 'v1.2.3-beta..1'];
    for (const input of invalid) {
      assert.throws(() => parseReleaseVersion(input), /not a semantic version/, input);
    }
  });

  it('rejects version parts browsers cannot store', () => {
    assert.throws(() => parseReleaseVersion('1.65536.0'), /above 65535/);
  });
});

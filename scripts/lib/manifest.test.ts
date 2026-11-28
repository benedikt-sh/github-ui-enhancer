import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildManifest, FIREFOX_ADDON_ID, MIN_CHROME_VERSION } from './manifest.ts';

describe('buildManifest', () => {
  it('uses a service worker and a minimum version for chrome', () => {
    const manifest = buildManifest({ target: 'chrome', version: '1.2.3' });

    assert.deepEqual(manifest['background'], { service_worker: 'background.js' });
    assert.equal(manifest['minimum_chrome_version'], MIN_CHROME_VERSION);
    assert.equal(manifest['browser_specific_settings'], undefined);
  });

  it('adds a version name for chrome prereleases only', () => {
    const chrome = buildManifest({ target: 'chrome', version: '2.0.0', versionName: '2.0.0-rc.1' });
    const firefox = buildManifest({ target: 'firefox', version: '2.0.0', versionName: '2.0.0-rc.1' });
    const release = buildManifest({ target: 'chrome', version: '2.0.0', versionName: '2.0.0' });

    assert.equal(chrome['version_name'], '2.0.0-rc.1');
    assert.equal(firefox['version_name'], undefined);
    assert.equal(release['version_name'], undefined);
  });

  it('uses background scripts and gecko settings for firefox', () => {
    const manifest = buildManifest({ target: 'firefox', version: '1.2.3' });

    assert.deepEqual(manifest['background'], { scripts: ['background.js'] });
    assert.equal(manifest['minimum_chrome_version'], undefined);
    const settings = manifest['browser_specific_settings'] as { gecko: { id: string } };
    assert.equal(settings.gecko.id, FIREFOX_ADDON_ID);
  });

  it('shares permissions, version and content script for both targets', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const manifest = buildManifest({ target, version: '0.9.0' });

      assert.equal(manifest['manifest_version'], 3);
      assert.equal(manifest['version'], '0.9.0');
      assert.deepEqual(manifest['permissions'], ['storage', 'unlimitedStorage']);
      assert.deepEqual(manifest['host_permissions'], ['https://api.github.com/*']);
      assert.deepEqual(manifest['content_scripts'], [
        {
          matches: ['https://github.com/*'],
          js: ['content.js'],
          css: ['content.css'],
          run_at: 'document_start',
        },
      ]);
    }
  });
});

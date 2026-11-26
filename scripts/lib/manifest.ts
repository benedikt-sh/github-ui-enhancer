export type BrowserTarget = 'chrome' | 'firefox';

export const BROWSER_TARGETS: readonly BrowserTarget[] = ['chrome', 'firefox'];

export const MIN_CHROME_VERSION = '121';
export const MIN_FIREFOX_VERSION = '121.0';

// Placeholder add-on id. AMO signing needs a stable id, so changing it later orphans
// existing Firefox installs and their stored tokens.
export const FIREFOX_ADDON_ID = 'github-ui-enhancer@extension';

export interface ManifestInput {
  target: BrowserTarget;
  version: string;
}

export function buildManifest({ target, version }: ManifestInput): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: 'GitHub UI Enhancer',
    description: 'Replaces the GitHub start page with a configurable dashboard of widgets.',
    version,
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: ['https://api.github.com/*'],
    content_scripts: [
      {
        // All pages, not just "/": GitHub navigates client-side, so the script must already
        // be present when the user navigates to the start page from elsewhere.
        matches: ['https://github.com/*'],
        js: ['content.js'],
        css: ['content.css'],
        run_at: 'document_start',
      },
    ],
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  };

  if (target === 'chrome') {
    manifest['background'] = { service_worker: 'background.js' };
    manifest['minimum_chrome_version'] = MIN_CHROME_VERSION;
  } else {
    manifest['background'] = { scripts: ['background.js'] };
    manifest['browser_specific_settings'] = {
      gecko: {
        id: FIREFOX_ADDON_ID,
        strict_min_version: MIN_FIREFOX_VERSION,
        data_collection_permissions: { required: ['none'] },
      },
    };
  }

  return manifest;
}

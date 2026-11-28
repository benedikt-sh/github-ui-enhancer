import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as esbuild from 'esbuild';

import { BROWSER_TARGETS, buildManifest, MIN_CHROME_VERSION, MIN_FIREFOX_VERSION } from './lib/manifest.ts';
import type { BrowserTarget } from './lib/manifest.ts';
import { parseReleaseVersion } from './lib/version.ts';

const watch = process.argv.includes('--watch');
const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
  .version;
// Release builds take the version from the git tag, see .github/workflows/release.yml.
const release = parseReleaseVersion(process.env['EXTENSION_VERSION'] ?? packageVersion);

const STATIC_FILES: ReadonlyArray<[from: string, to: string]> = [
  ['src/options/options.html', 'options.html'],
];

function buildOptions(target: BrowserTarget): esbuild.BuildOptions {
  return {
    entryPoints: {
      background: 'src/background/index.ts',
      content: 'src/content/index.ts',
      options: 'src/options/index.ts',
    },
    outdir: join('dist', target),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: [`chrome${MIN_CHROME_VERSION}`, `firefox${MIN_FIREFOX_VERSION.split('.')[0]}`],
    sourcemap: watch ? 'inline' : false,
    minify: !watch,
    legalComments: 'inline',
    logLevel: 'info',
  };
}

function cssOptions(target: BrowserTarget): esbuild.BuildOptions {
  return {
    entryPoints: { content: 'src/content/content.css', options: 'src/options/options.css' },
    outdir: join('dist', target),
    bundle: true,
    minify: !watch,
    logLevel: 'info',
  };
}

function writeStaticFiles(target: BrowserTarget): void {
  const outdir = join('dist', target);
  mkdirSync(outdir, { recursive: true });
  writeFileSync(
    join(outdir, 'manifest.json'),
    `${JSON.stringify(
      buildManifest({ target, version: release.version, versionName: release.semver }),
      null,
      2,
    )}\n`,
  );
  for (const [from, to] of STATIC_FILES) {
    copyFileSync(from, join(outdir, to));
  }
}

rmSync('dist', { recursive: true, force: true });

for (const target of BROWSER_TARGETS) {
  writeStaticFiles(target);
  if (watch) {
    const scripts = await esbuild.context(buildOptions(target));
    const styles = await esbuild.context(cssOptions(target));
    await Promise.all([scripts.watch(), styles.watch()]);
  } else {
    await esbuild.build(buildOptions(target));
    await esbuild.build(cssOptions(target));
  }
}

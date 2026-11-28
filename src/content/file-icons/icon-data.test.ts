import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FILE_ICONS } from './icon-data.ts';

describe('FILE_ICONS', () => {
  it('has a path, a valid color and a known size for every icon', () => {
    for (const [id, icon] of Object.entries(FILE_ICONS)) {
      assert.match(icon.path, /^[Mm][\d\s.,a-zA-Z-]+$/, id);
      assert.ok(icon.hex === null || /^[0-9A-F]{6}$/.test(icon.hex), id);
      assert.ok(icon.size === 16 || icon.size === 24, id);
      assert.notEqual(icon.title, '', id);
    }
  });

  it('covers the requested tools', () => {
    const required = [
      'typescript', 'javascript', 'nodedotjs', 'npm', 'pnpm', 'yarn', 'markdown', 'json', 'yaml',
      'toml', 'git', 'githubactions', 'docker', 'editorconfig', 'eslint', 'prettier', 'python',
      'go', 'rust', 'openjdk', 'kotlin', 'dotnet', 'ruby', 'php', 'html5', 'css', 'sass',
      'vuedotjs', 'svelte', 'react', 'gnubash', 'terraform', 'ansible', 'kubernetes', 'helm',
      'nginx', 'gnu', 'graphql', 'vite', 'vitest', 'jest', 'webpack', 'babel', 'renovate',
      'dependabot', 'dotenv', 'license',
    ];
    for (const id of required) {
      assert.ok(Object.hasOwn(FILE_ICONS, id), id);
    }
  });
});

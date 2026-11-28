import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveFileIcon } from './resolve-icon.ts';

function check(cases: Readonly<Record<string, string | null>>): void {
  for (const [path, expected] of Object.entries(cases)) {
    assert.equal(resolveFileIcon(path), expected, path);
  }
}

describe('resolveFileIcon', () => {
  it('matches the files from the reference screenshot', () => {
    check({
      '.editorconfig': 'editorconfig',
      '.gitignore': 'git',
      '.gitattributes': 'git',
      'README.md': 'markdown',
      'package.json': 'npm',
      'pnpm-lock.yaml': 'pnpm',
      'pnpm-workspace.yaml': 'pnpm',
      'tsconfig.json': 'typescript',
      'index.ts': 'typescript',
    });
  });

  it('prefers exact file names over extensions', () => {
    check({
      'Dockerfile': 'docker',
      '.dockerignore': 'docker',
      'Makefile': 'gnu',
      'Chart.yaml': 'helm',
      'Cargo.toml': 'rust',
      'go.mod': 'go',
      'pom.xml': 'apachemaven',
      'build.gradle.kts': 'gradle',
      'yarn.lock': 'yarn',
      'CODEOWNERS': 'github',
      '.env': 'dotenv',
      'LICENSE': 'license',
      'renovate.json': 'renovate',
    });
  });

  it('matches name prefixes of config files', () => {
    check({
      'vite.config.ts': 'vite',
      'vitest.config.mts': 'vitest',
      'jest.config.js': 'jest',
      'webpack.config.cjs': 'webpack',
      'babel.config.json': 'babel',
      '.babelrc.js': 'babel',
      'eslint.config.mjs': 'eslint',
      '.eslintrc.json': 'eslint',
      '.prettierrc.yaml': 'prettier',
      'tsconfig.build.json': 'typescript',
      'compose.yaml': 'docker',
      'docker-compose.override.yml': 'docker',
      'Dockerfile.dev': 'docker',
      '.env.local': 'dotenv',
      '.env.production.local': 'dotenv',
      'LICENSE.md': 'license',
      'renovate.json5': 'renovate',
    });
  });

  it('tries compound extensions before their tail', () => {
    check({
      'types.d.ts': 'typescript',
      'Button.stories.tsx': 'storybook',
      'parser.test.ts': 'typescript',
      'app.module.scss': 'sass',
      'App.tsx': 'react',
      'App.jsx': 'react',
    });
  });

  it('matches plain extensions', () => {
    check({
      'main.go': 'go',
      'lib.rs': 'rust',
      'Main.java': 'openjdk',
      'App.kt': 'kotlin',
      'Program.cs': 'dotnet',
      'App.csproj': 'dotnet',
      'App.sln': 'dotnet',
      'app.rb': 'ruby',
      'index.php': 'php',
      'index.html': 'html5',
      'style.css': 'css',
      'App.vue': 'vuedotjs',
      'Page.svelte': 'svelte',
      'install.sh': 'gnubash',
      'main.tf': 'terraform',
      'schema.graphql': 'graphql',
      'script.py': 'python',
      'data.json': 'json',
      'config.toml': 'toml',
      'values.yaml': 'yaml',
      'rules.mk': 'gnu',
      '.bashrc': 'gnubash',
      'server.mjs': 'javascript',
    });
  });

  it('ignores case', () => {
    check({ 'README.MD': 'markdown', 'PACKAGE.JSON': 'npm', 'makefile': 'gnu' });
  });

  it('recognizes GitHub config locations from the path', () => {
    check({
      '.github/workflows/ci.yml': 'githubactions',
      '/octo/repo/blob/main/.github/workflows/release.yaml': 'githubactions',
      '.github/workflows/README.md': 'markdown',
      'docs/workflows/ci.yml': 'yaml',
      '.github/dependabot.yml': 'dependabot',
      '/octo/repo/blob/main/.github/dependabot.yaml': 'dependabot',
      'dependabot.yml': 'yaml',
    });
  });

  it('returns null for unknown files and empty names', () => {
    check({
      'notes.txt': null,
      'binary': null,
      'archive.tar.gz': null,
      '': null,
      'src/': null,
      'constructor': null,
      'x.__proto__': null,
    });
  });
});

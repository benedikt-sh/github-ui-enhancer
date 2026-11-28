import type { FileIconId } from './icon-data.ts';

type Table = Readonly<Record<string, FileIconId>>;

function table(groups: Readonly<Partial<Record<FileIconId, readonly string[]>>>): Table {
  const result: Record<string, FileIconId> = {};
  for (const [id, keys] of Object.entries(groups) as [FileIconId, readonly string[]][]) {
    for (const key of keys) {
      result[key] = id;
    }
  }
  return result;
}

/** Lower case file names that belong to a tool regardless of their extension. */
const FILE_NAMES = table({
  'angular': ['angular.json'],
  'ansible': ['ansible.cfg', '.ansible-lint', 'playbook.yml', 'playbook.yaml'],
  'apachemaven': ['pom.xml', 'mvnw', 'mvnw.cmd'],
  'biome': ['biome.json', 'biome.jsonc'],
  'bun': ['bun.lock', 'bun.lockb', 'bunfig.toml'],
  'cmake': ['cmakelists.txt'],
  'codecov': ['codecov.yml', 'codecov.yaml', '.codecov.yml', '.codecov.yaml'],
  'deno': ['deno.json', 'deno.jsonc', 'deno.lock'],
  'docker': ['dockerfile', 'containerfile', '.dockerignore'],
  'dotenv': ['.env'],
  'editorconfig': ['.editorconfig'],
  'eslint': ['.eslintrc', '.eslintignore'],
  'git': ['.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', '.git-blame-ignore-revs'],
  'github': ['codeowners'],
  'gitlab': ['.gitlab-ci.yml', '.gitlab-ci.yaml'],
  'gnu': ['makefile', 'gnumakefile'],
  'go': ['go.mod', 'go.sum', 'go.work', 'go.work.sum'],
  'gradle': [
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'gradle.properties',
    'gradlew',
    'gradlew.bat',
  ],
  'helm': ['chart.yaml', 'chart.yml', 'chart.lock', 'helmfile.yaml', '.helmignore'],
  'kubernetes': ['kustomization.yaml', 'kustomization.yml'],
  'license': ['license', 'licence', 'copying', 'unlicense'],
  'netlify': ['netlify.toml'],
  'nginx': ['nginx.conf'],
  'nodedotjs': ['.nvmrc', '.node-version'],
  'npm': ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc', '.npmignore'],
  'pnpm': ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.pnpmfile.cjs', '.pnpmfile.mjs'],
  'poetry': ['poetry.lock'],
  'prettier': ['.prettierrc', '.prettierignore'],
  'pytest': ['pytest.ini', 'conftest.py'],
  'python': ['requirements.txt', 'pyproject.toml', 'pipfile', 'pipfile.lock', '.python-version'],
  'renovate': ['.renovaterc'],
  'ruby': ['gemfile', 'gemfile.lock', 'rakefile', '.ruby-version'],
  'ruff': ['ruff.toml', '.ruff.toml'],
  'rust': ['cargo.toml', 'cargo.lock', 'rust-toolchain', 'rust-toolchain.toml'],
  'stylelint': ['.stylelintrc', '.stylelintignore'],
  'terraform': ['.terraform.lock.hcl'],
  'turborepo': ['turbo.json'],
  'uv': ['uv.lock'],
  'vercel': ['vercel.json'],
  'yarn': ['yarn.lock', '.yarnrc', '.yarnrc.yml'],
});

/**
 * Lower case name prefixes up to the first dot that follows them, so `vite.config` matches
 * `vite.config.ts` and `tsconfig` matches `tsconfig.build.json`.
 */
const NAME_PREFIXES = table({
  'astro': ['astro.config'],
  'babel': ['babel.config', '.babelrc'],
  'cypress': ['cypress.config'],
  'docker': ['dockerfile', 'compose', 'docker-compose'],
  'dotenv': ['.env'],
  'eslint': ['eslint.config', '.eslintrc'],
  'javascript': ['jsconfig'],
  'jest': ['jest.config'],
  'license': ['license', 'licence', 'copying'],
  'nextdotjs': ['next.config'],
  'nuxt': ['nuxt.config'],
  'prettier': ['prettier.config', '.prettierrc'],
  'renovate': ['renovate', '.renovaterc'],
  'rollupdotjs': ['rollup.config'],
  'stylelint': ['stylelint.config', '.stylelintrc'],
  'tailwindcss': ['tailwind.config'],
  'typescript': ['tsconfig'],
  'vite': ['vite.config'],
  'vitest': ['vitest.config', 'vitest.workspace'],
  'webpack': ['webpack.config'],
});

/** Lower case extensions without the leading dot, compound ones are tried before their tail. */
const EXTENSIONS = table({
  'astro': ['astro'],
  'c': ['c', 'h'],
  'cmake': ['cmake'],
  'cplusplus': ['cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'h++'],
  'css': ['css'],
  'dart': ['dart'],
  'docker': ['dockerfile'],
  'dotenv': ['env'],
  'dotnet': ['cs', 'csx', 'csproj', 'fs', 'fsproj', 'sln', 'slnx', 'vb', 'vbproj'],
  'elixir': ['ex', 'exs'],
  'gnu': ['mk'],
  'gnubash': ['sh', 'bash', 'zsh', 'bashrc', 'zshrc', 'bash_profile'],
  'go': ['go'],
  'gradle': ['gradle', 'gradle.kts'],
  'graphql': ['graphql', 'gql', 'graphqls'],
  'haskell': ['hs', 'lhs'],
  'html5': ['html', 'htm', 'xhtml'],
  'javascript': ['js', 'mjs', 'cjs'],
  'jupyter': ['ipynb'],
  'kotlin': ['kt', 'kts'],
  'less': ['less'],
  'lua': ['lua'],
  'markdown': ['md', 'markdown'],
  'mdx': ['mdx'],
  'json': ['json', 'jsonc', 'json5'],
  'openjdk': ['java', 'jar'],
  'php': ['php', 'phtml'],
  'python': ['py', 'pyi', 'pyw'],
  'react': ['jsx', 'tsx'],
  'ruby': ['rb', 'rake', 'gemspec', 'erb'],
  'rust': ['rs'],
  'sass': ['scss', 'sass'],
  'scala': ['scala', 'sc', 'sbt'],
  'storybook': ['stories.js', 'stories.jsx', 'stories.ts', 'stories.tsx', 'stories.mdx'],
  'svelte': ['svelte'],
  'svg': ['svg'],
  'swift': ['swift'],
  'terraform': ['tf', 'tfvars'],
  'toml': ['toml'],
  'typescript': ['ts', 'mts', 'cts', 'd.ts', 'd.mts', 'd.cts'],
  'vuedotjs': ['vue'],
  'xml': ['xml', 'xsd', 'xsl', 'xslt'],
  'yaml': ['yml', 'yaml'],
  'zig': ['zig'],
});

const WORKFLOW_DIRECTORY = '/.github/workflows/';
const DEPENDABOT_CONFIGS = ['/.github/dependabot.yml', '/.github/dependabot.yaml'];

/**
 * `path` is a file path with `/` separators, a link path like `/owner/repo/blob/main/a/b.ts` or
 * a bare file name. Rules in order: GitHub's own config locations, exact file names, name
 * prefixes, then the longest matching extension. Case is ignored.
 */
export function resolveFileIcon(path: string): FileIconId | null {
  const lowerPath = `/${path.toLowerCase()}`;
  const name = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);
  if (name === '') {
    return null;
  }
  return (
    githubConfigIcon(lowerPath, name) ??
    lookup(FILE_NAMES, name) ??
    prefixIcon(name) ??
    extensionIcon(name)
  );
}

function githubConfigIcon(lowerPath: string, name: string): FileIconId | null {
  if (DEPENDABOT_CONFIGS.some((config) => lowerPath.endsWith(config))) {
    return 'dependabot';
  }
  const inWorkflows = lowerPath.endsWith(`${WORKFLOW_DIRECTORY}${name}`);
  return inWorkflows && /\.ya?ml$/.test(name) ? 'githubactions' : null;
}

function prefixIcon(name: string): FileIconId | null {
  for (let dot = name.indexOf('.', 1); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    const icon = lookup(NAME_PREFIXES, name.slice(0, dot));
    if (icon !== null) {
      return icon;
    }
  }
  return null;
}

function extensionIcon(name: string): FileIconId | null {
  for (let dot = name.indexOf('.'); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    const icon = lookup(EXTENSIONS, name.slice(dot + 1));
    if (icon !== null) {
      return icon;
    }
  }
  return null;
}

function lookup(source: Table, key: string): FileIconId | null {
  return Object.hasOwn(source, key) ? (source[key] ?? null) : null;
}

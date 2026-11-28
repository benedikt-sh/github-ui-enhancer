# GitHub UI Enhancer

> [!NOTE]
> This is an independent project. It is not affiliated with, endorsed by or in any way officially associated with GitHub, Inc. GitHub and the GitHub logo are trademarks of GitHub, Inc.

A browser extension for Chrome/Chromium and Firefox that replaces the github.com start page with a configurable dashboard and adds a few quality-of-life tweaks to GitHub.

All data comes from the official GitHub API. The extension never writes anything to GitHub.

## Features

### Dashboard

The start page you see on github.com while signed in becomes a grid of widgets. Every widget can be added as often as you like, configured, resized (half or full width) and reordered by dragging its title bar or via its menu. Widgets fill gaps below shorter neighbors, so the dashboard stays compact.

| Widget | What it shows |
|---|---|
| Pull requests | Assigned to you, review requested, created by you, or any custom search |
| Issues | Assigned to you, watched by you, created by you, or any custom search |
| Actions runs | Workflow runs of one repository, optionally filtered by branch and to failed runs only |
| Recent repositories | Repositories you recently changed (pushes, pull requests, new branches), including private ones |
| Dependabot pull requests | Open Dependabot pull requests in the repositories you select |
| Repository search | Instant search over all repositories of your account and of every organization you added a token for |

GitHub's original start page stays one click away ("Show GitHub's page"), and the feed is still available at `/feed`.

### Tweaks

The settings page groups small tweaks by the area of GitHub they affect. Changes apply immediately, also in tabs that are already open.

| Area | Tweak | Default |
|---|---|---|
| Dashboard | Enhanced dashboard: replace GitHub's start page with the widget dashboard | on |
| Dashboard | Hide GitHub's changelog widget; the dashboard then uses the freed space | off |
| Header bar | Pinned repositories as quick links in GitHub's header, optionally plus the repository you were active in most recently | off |
| Repository pages | File type icons next to known files and tools in the file list (Simple Icons, bundled with the extension) | on |
| Navigation | Repo quick switcher: press Shift twice to search and open any of your repositories, fully keyboard driven | on |

## Requirements

- Chrome/Chromium 126 or newer, or Firefox 128 or newer
- To build: Node.js 24 or newer and pnpm

## Download

Ready-made packages for both browsers are attached to every [GitHub release](https://github.com/benedikt-sh/github-ui-enhancer/releases). Download the zip for your browser, unpack it into a folder you keep and follow the steps under [Install](#install). The extension is not published in any extension store.

## Build

```bash
pnpm install
```

```bash
pnpm build
```

The extension is written to `dist/chrome/` and `dist/firefox/`.

## Install

### Chrome / Chromium

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the unpacked release folder or `dist/chrome`.

After a new build, click the reload icon of the extension in `chrome://extensions` and reload the GitHub tab.

### Firefox

For trying it out:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `manifest.json` from the unpacked release folder or `dist/firefox/manifest.json`.

Temporary add-ons are removed when Firefox quits. A permanent installation requires signing the extension on addons.mozilla.org, which is also possible as an "unlisted" add-on for personal use.

If Firefox did not grant access to `github.com` and `api.github.com` during installation, open `about:addons`, select the extension, go to the **Permissions** tab and allow both sites.

## Set up access tokens

The extension uses **fine-grained personal access tokens with read-only permissions**, one per account or organization. A fine-grained token always belongs to exactly one resource owner. Classic tokens are deliberately not supported, because for private repositories they always include write access.

1. Create a token at [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Resource owner:** first your own account, then one more token per organization. If an organization is missing from the list, it does not allow fine-grained tokens.
3. **Repository access:** All repositories.
4. **Repository permissions**, all set to **Read-only**:
   - Metadata
   - Contents
   - Pull requests
   - Issues
   - Actions
5. Set an expiration date. The extension warns you 14 days in advance.
6. Paste the token on the extension's settings page (right-click the extension icon and choose **Options**, or use the link on the dashboard).

Some organizations require an admin to approve new tokens. Until then the settings page shows the token as waiting for approval.

## Security and privacy

- **Storage:** tokens are kept only in the browser profile's `storage.local`, never in `storage.sync`. They never leave the extension's background context; the script running on github.com only receives the resulting data.
- **Read-only:** in addition to the read-only token permissions, the API client only allows read requests and refuses GraphQL mutations.
- **No third parties:** there is no server and no tracking. Network requests go to `api.github.com` only.

## Known limitations

- **Missing repositories:** repositories where you are an outside collaborator of an organization, and repositories owned by other users, cannot be reached with fine-grained tokens.
- **No live layout sync:** dashboard layout changes made in another tab show up after a reload.
- **Depends on GitHub's markup:** if GitHub fundamentally changes the structure of a page, the extension leaves that page untouched until its hooks are updated.

## Development

```bash
pnpm check
```

Runs the type check, the long-dash check, the tests with coverage thresholds and the build.

```bash
pnpm watch
```

Rebuilds on every change.

```bash
pnpm test:perf
```

Checks the time budgets of the repository search. These tests are not part of `pnpm check` because they are unreliable on a busy machine.

### Releases

Pushing a tag in semantic version format starts the release workflow (`.github/workflows/release.yml`). It runs `pnpm check`, builds both packages with the version from the tag and creates a GitHub release with the zip files, checksums and generated release notes. Tags with a prerelease part (e.g. `v1.2.0-rc.1`) become prereleases.

```bash
git tag v0.2.0
```

```bash
git push origin v0.2.0
```

The tag is the source of truth for the version: browsers only accept `major.minor.patch` as manifest version, so a prerelease suffix is shown in Chrome as version name only.

Working rules and project decisions are documented in `CLAUDE.md`. Background research and the original implementation plan are in `docs/machbarkeit.md` and `docs/plan.md` (both in German).

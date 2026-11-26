/** Test markup modeled on github.com's logged-in layout (Turbo body, AppHeader, React main). */

export type PageVariant = 'main' | 'role-main' | 'application-main' | 'header-only' | 'bare';

export interface PageOptions {
  /** Null omits the meta tag, an empty string mimics the logged-out marketing page. */
  readonly login?: string | null;
  readonly variant?: PageVariant;
}

const HEADER = `
  <div class="position-relative header-wrapper js-header-wrapper">
    <a href="#start-of-content" class="skip-link">Skip to content</a>
    <header class="AppHeader" role="banner">
      <div class="AppHeader-globalBar"><a class="AppHeader-logo" href="/">GitHub</a></div>
    </header>
  </div>
  <div id="start-of-content" class="show-on-focus"></div>
  <div id="js-flash-container" class="flash-container"></div>`;

const DASHBOARD = `
  <div id="dashboard" class="d-flex dashboard">
    <react-app app-name="dashboard"><div data-target="react-app.reactRoot">Home</div></react-app>
  </div>`;

const FOOTER = '<footer class="footer">Footer</footer>';

function content(variant: PageVariant): string {
  switch (variant) {
    case 'main':
      return `${HEADER}<div class="application-main"><main>${DASHBOARD}</main></div>${FOOTER}`;
    case 'role-main':
      return `${HEADER}<div class="page"><div role="main">${DASHBOARD}</div></div>${FOOTER}`;
    case 'application-main':
      return `${HEADER}<div class="application-main">${DASHBOARD}</div>${FOOTER}`;
    case 'header-only':
      return `${HEADER}<div class="page">${DASHBOARD}</div>${FOOTER}`;
    case 'bare':
      return `<div class="page">${DASHBOARD}</div>`;
  }
}

export function renderPage(document: Document, options: PageOptions = {}): void {
  const login = options.login === undefined ? 'octocat' : options.login;
  document.head.innerHTML = login === null ? '' : `<meta name="user-login" content="${login}">`;
  document.body.className = login ? 'logged-in env-production' : 'logged-out env-production';
  document.body.innerHTML = `
    <div data-turbo-body class="${document.body.className}">${content(options.variant ?? 'main')}</div>
    <div id="__primerPortalRoot__"></div>`;
}

/** Mimics a Turbo or React page swap: same markup, but every element is new. */
export function replaceBody(document: Document): void {
  const next = document.createElement('body');
  next.className = document.body.className;
  next.innerHTML = document.body.innerHTML;
  document.documentElement.replaceChild(next, document.body);
}

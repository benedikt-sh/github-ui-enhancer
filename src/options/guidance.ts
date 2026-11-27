import { h, safeUrl } from '../ui/dom.ts';
import { icon } from '../ui/octicons.ts';
import { EXPIRY_WARNING_DAYS } from './token-status.ts';

export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** Repository permissions the data layer needs, all read-only. */
export const REQUIRED_PERMISSIONS = [
  'Metadata',
  'Contents',
  'Pull requests',
  'Issues',
  'Actions',
] as const;

function externalLink(url: string, label: string): HTMLAnchorElement {
  return h(
    'a',
    {
      className: 'ghx-link',
      href: safeUrl(url),
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    label,
    icon('link-external'),
  );
}

export function guidance(): HTMLDivElement {
  return h(
    'div',
    { className: 'ghx-guidance' },
    h(
      'p',
      null,
      'The dashboard reads data from GitHub with fine-grained personal access tokens. A token ' +
        'only covers one resource owner, so create one read-only token for your personal ' +
        'account and one for each organization you want to see.',
    ),
    h(
      'ol',
      { className: 'ghx-guidance__steps' },
      h(
        'li',
        null,
        externalLink(NEW_TOKEN_URL, 'Generate a new fine-grained token'),
        ' on GitHub.',
      ),
      h(
        'li',
        null,
        'Choose your account or an organization as ',
        h('strong', null, 'Resource owner'),
        '.',
      ),
      h(
        'li',
        null,
        'Under ',
        h('strong', null, 'Repository access'),
        ', select ',
        h('strong', null, 'All repositories'),
        '.',
      ),
      h(
        'li',
        null,
        'Under ',
        h('strong', null, 'Repository permissions'),
        ', set these to ',
        h('strong', null, 'Read-only'),
        ' and leave everything else at no access:',
        h(
          'ul',
          { className: 'ghx-guidance__permissions' },
          REQUIRED_PERMISSIONS.map((permission) => h('li', null, permission)),
        ),
      ),
      h('li', null, 'Generate the token, copy it and add it below.'),
    ),
    h(
      'ul',
      { className: 'ghx-guidance__notes' },
      h(
        'li',
        null,
        'Organizations must allow fine-grained tokens, otherwise they are not offered as ' +
          'resource owner. They may also require an owner to approve the token. Until then it ' +
          'is listed as pending approval.',
      ),
      h(
        'li',
        null,
        'Classic tokens are not supported because they always allow writing to your ' +
          'repositories. The extension never changes anything on GitHub.',
      ),
      h(
        'li',
        null,
        `Tokens expire. The list warns ${EXPIRY_WARNING_DAYS} days ahead, then create a new ` +
          'token and remove the old one.',
      ),
      h(
        'li',
        null,
        'Tokens are stored only in this browser profile. They are never synced and never ' +
          'shown on github.com.',
      ),
    ),
  );
}

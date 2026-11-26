import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import {
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime,
  formatShortDate,
  relativeTime,
} from './time.ts';

// Each test file runs in its own process, so pinning the zone here affects no other tests.
process.env['TZ'] = 'UTC';

const NOW = new Date('2026-11-26T12:00:00Z');
const ago = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('formatRelativeTime', () => {
  it('says "just now" within the first minute and for future dates', () => {
    assert.equal(formatRelativeTime(NOW, NOW), 'just now');
    assert.equal(formatRelativeTime(ago(59), NOW), 'just now');
    assert.equal(formatRelativeTime(ago(-300), NOW), 'just now');
  });

  it('counts minutes and hours with singular and plural', () => {
    assert.equal(formatRelativeTime(ago(60), NOW), '1 minute ago');
    assert.equal(formatRelativeTime(ago(5 * 60 + 30), NOW), '5 minutes ago');
    assert.equal(formatRelativeTime(ago(3600), NOW), '1 hour ago');
    assert.equal(formatRelativeTime(ago(23 * 3600 + 3599), NOW), '23 hours ago');
  });

  it('says "yesterday" and then counts days', () => {
    assert.equal(formatRelativeTime(ago(86400), NOW), 'yesterday');
    assert.equal(formatRelativeTime(ago(3 * 86400), NOW), '3 days ago');
    assert.equal(formatRelativeTime(ago(29 * 86400), NOW), '29 days ago');
  });

  it('falls back to a short date after 30 days', () => {
    assert.equal(formatRelativeTime('2026-10-27T12:00:00Z', NOW), 'on Oct 27');
    assert.equal(formatRelativeTime('2025-12-24T08:00:00Z', NOW.getTime()), 'on Dec 24, 2025');
  });

  it('accepts ISO strings and timestamps', () => {
    const text = formatRelativeTime('2026-11-26T11:58:00Z', '2026-11-26T12:00:00Z');
    assert.equal(text, '2 minutes ago');
  });

  it('returns an empty string for invalid dates', () => {
    assert.equal(formatRelativeTime('not a date', NOW), '');
    assert.equal(formatRelativeTime(NOW, 'not a date'), '');
  });
});

describe('formatShortDate', () => {
  it('omits the year only for the current year', () => {
    assert.equal(formatShortDate('2026-01-02T12:00:00Z', NOW), 'Jan 2');
    assert.equal(formatShortDate('2024-01-02T12:00:00Z', NOW), 'Jan 2, 2024');
  });
});

describe('formatAbsoluteTime', () => {
  it('includes date and time', () => {
    const text = formatAbsoluteTime('2026-11-26T09:05:00Z');

    assert.match(text, /Nov 26, 2026/);
    assert.match(text, /9:05/);
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    assert.equal(formatDuration(0), '0s');
    assert.equal(formatDuration(45_400), '45s');
    assert.equal(formatDuration(120_000), '2m');
    assert.equal(formatDuration(192_000), '3m 12s');
    assert.equal(formatDuration(3_600_000), '1h');
    assert.equal(formatDuration(3_900_000), '1h 5m');
  });

  it('returns an empty string for negative and invalid durations', () => {
    assert.equal(formatDuration(-1), '');
    assert.equal(formatDuration(Number.NaN), '');
    assert.equal(formatDuration(Number.POSITIVE_INFINITY), '');
  });
});

describe('relativeTime', () => {
  it('renders a time element with machine readable value and tooltip', () => {
    const element = relativeTime('2026-11-26T11:55:00Z', NOW);

    assert.equal(element.tagName, 'TIME');
    assert.equal(element.className, 'ghx-time');
    assert.equal(element.getAttribute('datetime'), '2026-11-26T11:55:00.000Z');
    assert.match(element.getAttribute('title') ?? '', /Nov 26, 2026/);
    assert.equal(element.textContent, '5 minutes ago');
  });

  it('renders an empty element for invalid dates', () => {
    const element = relativeTime('garbage', NOW);

    assert.equal(element.textContent, '');
    assert.equal(element.hasAttribute('datetime'), false);
  });
});

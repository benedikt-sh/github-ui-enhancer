import { h } from './dom.ts';

export type DateInput = string | number | Date;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Like GitHub, older timestamps show a date instead of "N days ago". */
const RELATIVE_DAYS = 30;

function toTime(value: DateInput): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** "Nov 3" in the current year, "Nov 3, 2024" otherwise, in the user's time zone. */
export function formatShortDate(value: DateInput, now: DateInput): string {
  const date = new Date(toTime(value));
  const sameYear = date.getFullYear() === new Date(toTime(now)).getFullYear();
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** Returns an empty string for invalid dates. Future dates (clock skew) count as "just now". */
export function formatRelativeTime(value: DateInput, now: DateInput): string {
  const time = toTime(value);
  const reference = toTime(now);
  if (Number.isNaN(time) || Number.isNaN(reference)) {
    return '';
  }
  const seconds = Math.floor((reference - time) / 1000);
  if (seconds < MINUTE) {
    return 'just now';
  }
  if (seconds < HOUR) {
    return `${plural(Math.floor(seconds / MINUTE), 'minute')} ago`;
  }
  if (seconds < DAY) {
    return `${plural(Math.floor(seconds / HOUR), 'hour')} ago`;
  }
  const days = Math.floor(seconds / DAY);
  if (days === 1) {
    return 'yesterday';
  }
  if (days < RELATIVE_DAYS) {
    return `${days} days ago`;
  }
  return `on ${formatShortDate(time, reference)}`;
}

export function formatAbsoluteTime(value: DateInput): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(toTime(value)),
  );
}

/** "45s", "3m 12s", "1h 5m". Negative or invalid durations give an empty string. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return '';
  }
  const total = Math.round(milliseconds / 1000);
  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const seconds = total % MINUTE;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

/** A `<time>` element with the relative text and the full timestamp as tooltip. */
export function relativeTime(value: DateInput, now: DateInput): HTMLTimeElement {
  const time = toTime(value);
  if (Number.isNaN(time)) {
    return h('time', { className: 'ghx-time' });
  }
  return h(
    'time',
    {
      className: 'ghx-time',
      datetime: new Date(time).toISOString(),
      title: formatAbsoluteTime(time),
    },
    formatRelativeTime(time, now),
  );
}

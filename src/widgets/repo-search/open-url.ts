export type OpenUrl = (url: string, newTab: boolean) => void;

export interface BrowserWindow {
  open(url: string, target: string, features: string): unknown;
  readonly location: { assign(url: string): void };
}

export function openUrlIn(win: BrowserWindow, url: string, newTab: boolean): void {
  if (newTab) {
    win.open(url, '_blank', 'noopener,noreferrer');
  } else {
    win.location.assign(url);
  }
}

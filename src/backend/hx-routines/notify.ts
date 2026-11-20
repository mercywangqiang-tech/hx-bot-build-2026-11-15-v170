/**
 * HXBot (v1.7.5, RTN-04): a desktop notification from the backend. The main process attaches the one
 * that shows it, and checks the person's notification setting; without it nothing shows.
 */

type HxNotify = (title: string, body: string) => void;

let notifier: HxNotify | null = null;

export function hxAttachNotifier(next: HxNotify | null): void {
  notifier = next;
}

export function hxNotify(title: string, body: string): void {
  try {
    notifier?.(title, body);
  } catch {
    // A notification that cannot show changes nothing else.
  }
}

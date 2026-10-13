/**
 * Tab-to-tab sync over a `BroadcastChannel`: same origin, same profile, no
 * permission, and nothing leaves the machine. A message reaches every other
 * scratchpad tab, never the one that sent it.
 */
import type { DraftEvent, DraftSync } from './types.ts';

const CHANNEL = 'scratchpad.drafts.v1';

export function broadcastSync(): DraftSync {
  if (typeof BroadcastChannel === 'undefined') {
    return { publish() {}, subscribe() {} };
  }
  const channel = new BroadcastChannel(CHANNEL);
  return {
    publish(event) {
      try {
        channel.postMessage(event);
      } catch {
        /* a closing tab: the disk already has the change */
      }
    },
    subscribe(handler) {
      channel.addEventListener('message', (message: MessageEvent<DraftEvent>) =>
        handler(message.data),
      );
    },
  };
}

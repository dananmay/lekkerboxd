import type { MessageToBackground } from '../../types/messages';

export function sendToBackground<T = unknown>(message: MessageToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

export function sendToTab<T = unknown>(tabId: number, message: unknown): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message);
}

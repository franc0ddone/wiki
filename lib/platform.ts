"use client";

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};
const readIsApple = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
/**
 * Server render and hydration assume a non-Apple (Windows 11) client, which is
 * the hospital's target platform. Windows clients therefore see the correct
 * `Ctrl K` hint in the server HTML with no flicker; an Apple client re-renders
 * once with `⌘K`.
 */
const readIsAppleOnServer = () => false;

export function useIsApplePlatform(): boolean {
  return useSyncExternalStore(subscribeNoop, readIsApple, readIsAppleOnServer);
}

/** The platform's search shortcut as it should be printed: `Ctrl K` or `⌘K`. */
export function useSearchShortcutLabel(): string {
  return useIsApplePlatform() ? "\u2318K" : "Ctrl K";
}

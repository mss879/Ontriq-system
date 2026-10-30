"use client";

import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
};
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const onServer = () => null;

/**
 * The current time, rounded to the minute and refreshed every 30 seconds, or
 * null on the server and during hydration. Callers render a fixed fallback
 * (a date) for null, so server and client markup always match and the clock
 * never enters the prerendered shell.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, currentMinute, onServer);
}

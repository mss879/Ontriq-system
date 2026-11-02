"use client";

import dynamic from "next/dynamic";

/**
 * Panels that stay closed until someone opens them. They load in the background
 * after the page, so nobody waits for the assistant or the palette on first load.
 */
export const CommandPalette = dynamic(() => import("@/components/command/command-palette").then((m) => m.CommandPalette), { ssr: false });
export const KeyboardShortcuts = dynamic(() => import("@/components/command/keyboard-shortcuts").then((m) => m.KeyboardShortcuts), { ssr: false });
export const AssistantPanel = dynamic(() => import("@/components/assistant/assistant-panel").then((m) => m.AssistantPanel), { ssr: false });

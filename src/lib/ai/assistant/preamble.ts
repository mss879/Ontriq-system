const HOLD_CHARS = 200;

/**
 * The model sometimes writes a line of planning before a tool call, whatever the
 * prompt says. So the start of each reply waits here: a tool call drops what's
 * held, and text that reaches the limit or the end of the reply goes out.
 */
export function preambleFilter(limit = HOLD_CHARS) {
  let held = "";
  let open = false;
  return {
    /** Takes a piece of text and returns what can be shown now. */
    text(delta: string): string {
      if (open) return delta;
      held += delta;
      if (held.length < limit) return "";
      open = true;
      const out = held;
      held = "";
      return out;
    },
    toolCall() {
      held = "";
    },
    /** What's left when the reply ends with no tool call. */
    end(): string {
      const out = held;
      held = "";
      return out;
    },
  };
}

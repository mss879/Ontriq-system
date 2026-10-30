/**
 * Full page load instead of a client transition. Used after sign-out and MFA,
 * where Next's guidance (02-guides/preserving-ui-state.md) is to reload so no
 * <Activity>-preserved screen keeps the previous session's state.
 */
export function hardNavigate(path: string): void {
  window.location.href = path;
}

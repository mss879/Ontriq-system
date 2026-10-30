export class AuthError extends Error {
  constructor(public readonly code: "unauthenticated" | "forbidden" | "mfa_required" | "inactive", message?: string) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

/** Friendly text for database errors surfaced to users (no internals). */
export function friendlyDbError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  switch (error.code) {
    case "42501":
      return error.message && !error.message.includes("row-level security")
        ? error.message
        : "You don't have permission to do that.";
    case "23505":
      return "That already exists.";
    case "23503":
      return "This refers to something that no longer exists.";
    case "23514":
      return "Some values are not allowed.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function authErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "unauthenticated":
      return "Your session has ended. Please sign in again.";
    case "mfa_required":
      return "Please complete two-step verification first.";
    case "inactive":
      return "Your account is not active yet.";
    default:
      return "You don't have permission to do that.";
  }
}

/**
 * Messages from the case engine's database functions. Guards raise 22023 with
 * a sentence written for people ("2 required document(s) still missing…"), so
 * those pass through; permission and not-found errors get standard wording.
 */
export function rpcErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  const text = (error.message ?? "").trim();
  if (error.code === "22023" && text) return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
  if (error.code === "42501") {
    return text && text !== "not allowed" && !text.includes("row-level security") && !text.startsWith("permission denied")
      ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
      : "You don't have permission to do that.";
  }
  if (error.code === "P0002") return "That record no longer exists, or you don't have access to it.";
  return friendlyDbError(error);
}

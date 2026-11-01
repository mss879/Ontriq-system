/**
 * Signs out with a plain form post. A server action can fail in a tab opened
 * before a redeploy, which leaves the button looking dead. This can't, and the
 * full page load leaves no screen state behind.
 */
export function signOutNow(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/auth/sign-out";
  document.body.append(form);
  form.submit();
}

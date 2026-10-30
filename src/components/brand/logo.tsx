import { cn } from "@/lib/utils";
import { LOGO_COLORS, LOGO_LOCKUP, LOGO_MARK, LOGO_TAGLINE, LOGO_WORDMARK } from "@/domain/brand/logo-paths";

/**
 * The official Ontriq logo, drawn from vector paths traced from the brand
 * artwork. Ink parts follow `currentColor`, so the wordmark turns white on
 * dark surfaces; the blue brightens slightly on dark backgrounds (the usual
 * reversed treatment) while the orange stays exact.
 */

const BLUE_ON_DARK = "#3D8FDB";

function blueStyle(reversed?: boolean): React.CSSProperties {
  return { fill: reversed ? BLUE_ON_DARK : "var(--logo-blue, #0C5A9A)" };
}

/** The orange-and-blue mark on its own. `tile` sets it on a white rounded square, like an app icon. */
export function LogoMark({ className, tile = false, reversed }: { className?: string; tile?: boolean; reversed?: boolean }) {
  const svg = (
    <svg
      viewBox={LOGO_MARK.viewBox}
      aria-hidden="true"
      className={cn("shrink-0", tile ? "h-[68%]! w-auto!" : cn("h-7 w-auto", className))}
    >
      <path fill={LOGO_COLORS.orange} d={LOGO_MARK.orange} />
      <path style={tile ? { fill: LOGO_COLORS.blue } : blueStyle(reversed)} d={LOGO_MARK.markblue} />
    </svg>
  );
  if (!tile) return svg;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[28%] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_0_0_1px_rgb(0_0_0/0.06)]",
        className,
      )}
    >
      {svg}
    </span>
  );
}

/** "ONTRIQ" with the blue Q tail. */
export function Wordmark({ className, reversed }: { className?: string; reversed?: boolean }) {
  return (
    <svg viewBox={LOGO_WORDMARK.viewBox} role="img" aria-label="Ontriq" className={cn("h-4 w-auto shrink-0", className)}>
      <path fill="currentColor" d={LOGO_WORDMARK.word} />
      <path style={blueStyle(reversed)} d={LOGO_WORDMARK.qtail} />
    </svg>
  );
}

/** "BY KONNECT BPO". */
export function Tagline({ className }: { className?: string }) {
  return (
    <svg viewBox={LOGO_TAGLINE.viewBox} aria-hidden="true" className={cn("h-2 w-auto shrink-0", className)}>
      <path fill="currentColor" d={LOGO_TAGLINE.tag} />
    </svg>
  );
}

/** The full lockup as on ontriq.com: mark, wordmark and the tagline (keep the tagline for sizes of 56px and up). */
export function LogoLockup({ className, tagline = true, reversed }: { className?: string; tagline?: boolean; reversed?: boolean }) {
  return (
    <svg viewBox={LOGO_LOCKUP.viewBox} role="img" aria-label="Ontriq by Konnect BPO" className={cn("h-10 w-auto shrink-0", className)}>
      <path fill={LOGO_COLORS.orange} d={LOGO_LOCKUP.orange} />
      <path style={blueStyle(reversed)} d={LOGO_LOCKUP.markblue} />
      <path fill="currentColor" d={LOGO_LOCKUP.word} />
      <path style={blueStyle(reversed)} d={LOGO_LOCKUP.qtail} />
      {tagline ? <path fill="currentColor" d={LOGO_LOCKUP.tag} /> : null}
    </svg>
  );
}

/**
 * The lockup with an optional product label beside it, e.g. "Client portal".
 * Used in page headers and on the sign-in screens.
 */
export function Logo({
  className,
  subtitle,
  tagline = false,
  reversed,
}: {
  className?: string;
  subtitle?: string;
  tagline?: boolean;
  reversed?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <LogoLockup tagline={tagline} reversed={reversed} className="h-8" />
      {subtitle ? (
        <span className="flex items-center gap-3">
          <span aria-hidden className="h-6 w-px bg-current opacity-15" />
          <span className="text-[13px] font-medium whitespace-nowrap opacity-70">{subtitle}</span>
        </span>
      ) : null}
    </span>
  );
}

import Link from "@/components/link";
import { Lock } from "lucide-react";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";
import { CANDIDATE_LANGS, type CandidateDict, type CandidateLang } from "@/domain/candidate/i18n";

/** Header, language switcher and footer around every candidate page. */
export function CandidateShell({
  lang,
  t,
  hrefFor,
  footer,
  children,
}: {
  lang: CandidateLang;
  t: CandidateDict;
  hrefFor: (lang: CandidateLang) => string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const htmlLang = CANDIDATE_LANGS.find((l) => l.key === lang)?.htmlLang ?? "en";
  return (
    <div lang={htmlLang} className="flex min-h-svh flex-col">
      <div aria-hidden className="h-1 brand-gradient-soft" />
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <LogoLockup tagline={false} className="h-6 text-foreground" />
          <span className="hidden items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground min-[400px]:flex">
            <Lock className="size-3" aria-hidden /> {t.meta.privatePage}
          </span>
          <nav aria-label={t.meta.language} className="ml-auto flex items-center rounded-lg bg-muted p-0.5">
            {CANDIDATE_LANGS.map((l) => (
              <Link
                key={l.key}
                href={hrefFor(l.key)}
                replace
                scroll={false}
                lang={l.htmlLang}
                aria-current={l.key === lang ? "true" : undefined}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  l.key === lang ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.native}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-5 pb-10">{children}</main>
      <footer className="border-t bg-muted/30">
        <div className="mx-auto max-w-2xl space-y-1.5 px-4 py-6 text-xs leading-relaxed text-muted-foreground">
          {footer}
          <p className="pt-1 text-[11px]">Ontriq (Pvt) Ltd · A Konnect BPO company</p>
        </div>
      </footer>
    </div>
  );
}

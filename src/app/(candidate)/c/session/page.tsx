import { Suspense } from "react";
import { connection } from "next/server";
import { asCandidateLang } from "@/domain/candidate/i18n";
import { loadCandidateView, readCandidateSession } from "@/lib/server/candidate/session";
import { ExpiredView } from "@/components/candidate/expired-view";
import { CandidatePage, CandidatePageSkeleton } from "@/components/candidate/candidate-page";

/**
 * The candidate's own page. No account: the signed cookie from /c/[token]
 * names the link, and everything shown comes from candidate_link_view (0008).
 */
export default function CandidateSessionPage({ searchParams }: PageProps<"/c/session">) {
  return (
    <Suspense fallback={<CandidatePageSkeleton />}>
      <Session searchParams={searchParams} />
    </Suspense>
  );
}

async function Session({ searchParams }: { searchParams: PageProps<"/c/session">["searchParams"] }) {
  const sp = await searchParams;
  const asked = asCandidateLang(Array.isArray(sp.lang) ? sp.lang[0] : sp.lang);
  await connection();
  const session = await readCandidateSession();
  const view = session ? await loadCandidateView(session.linkId) : null;
  if (!view) {
    const lang = asked ?? "en";
    return <ExpiredView lang={lang} reason={session ? "expired" : "session"} hrefFor={(l) => `/c/session?lang=${l}`} />;
  }
  return <CandidatePage view={view} lang={asked ?? view.link.language ?? view.candidate.preferred_language ?? "en"} />;
}

# Phase 0 spikes

| Spike | Result | Evidence |
|---|---|---|
| Sinhala and Tamil in PDFs (react-pdf + Noto Sans Sinhala/Tamil) | **Pass.** Conjuncts (ශ්‍රී), two-part vowel signs (කොළඹ, கொழும்பு) and names/addresses shape correctly, so reports can print local-language names and addresses without a fallback. | `npx tsx scripts/spikes/script-shaping.tsx /tmp/shaping.pdf` |
| Netlify streaming cut-off for the assistant route | **Pending.** Needs the deployed site. Plan: stream a 60-second response from a test route and record when Netlify closes it; if under 25 s, the assistant switches to job-plus-Realtime delivery. | — |
| Signed upload round trip (`uploadToSignedUrl` → finalize) | **Pending.** Needs Supabase Storage (not emulated locally). Runs first thing in Phase 1 against the hosted project. | — |

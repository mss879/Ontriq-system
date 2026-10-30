# Reading documents into checks

No migration. Builds on [AI routing](0018-ai.md) and the [AI pipeline](0029-ai-pipeline.md).

Whoever uploads a file (client portal, candidate link or staff), the same thing happens.

1. **Read.** `ai.classify_document` identifies the file, checks its quality, transcribes it in its original script and translates it into English when it isn't in English. Sinhala, Tamil, English and mixed documents are expected, printed or handwritten, as PDFs or photos.
2. **Route.** A file with a check feeds that check. Otherwise it goes to any check asking for its category, or for what the AI says it really is. A CV or a general PDF that matches nothing is offered to every check, so one PDF with all of a candidate's details works. If the first read fails, extraction still runs, because it reads the file itself.
3. **Extract.** `ai.extract_fields` returns values in English, with the original wording kept in the suggestion's note. It fills plain fields and repeating groups (employers, referees). Fields a person attests to, such as "Verified by", are never read from a document.
4. **Fill.** On the check page, values at or above 60% confidence go straight into empty fields. Nothing is stored until a person checks them against the file and saves; each can be undone. Lower-confidence values wait as suggestions, and existing values are never overwritten.
5. **Report.** Each check card lists what is still needed and how many details the AI found. The timeline records what was read, what it says overall and what is still missing. The file's chip shows the language and the English translation, or why the file couldn't be read.

## Limits

- `ANTHROPIC_API_KEY` must be set. Accuracy on real Sinhala and handwritten documents has not been measured yet.
- The first read and extraction ask for at least 12,000 and 8,000 tokens, whatever Settings → AI says, because Sinhala transcriptions run long.
- Each extraction reads up to six files per check, most relevant first.
- PDFs over 10 MB aren't read. Large photos are shrunk with `sharp` for the AI only; the stored file is untouched. Check that `sharp` is available on the Netlify worker: without it, photos over about 3.7 MB are marked as not read. HEIC photos need a JPEG or PDF instead unless the image library can read them.

Tests: `tests/unit/document-reading.test.ts`.

# Documents and evidence

Migration: `supabase/migrations/0007_documents.sql`  
Depends on: 0006

- `documents` link each file to a case, check, candidate and client, with versions, visibility (internal, client, report), review status and a sensitive flag from its category.
- Uploads: `begin_document_upload` creates the row and path; the server mints a signed upload URL; the browser uploads straight to the private `case-files` bucket; `finalize_document_upload` confirms it and retires the previous version.
- A trigger keeps requirement counts in step; `review_document` accepts or rejects (a rejection reopens the requirement); `set_document_visibility` needs `documents.manage_visibility`.
- Reads: staff with `documents.read` on a visible case; sensitive categories (police reports, sanction reports) also need `documents.read_sensitive`. `/api/files/<id>` re-checks access, logs the view in `document_access_log`, and redirects to a 60-second signed URL.
- `document_texts` and `document_ai` are ready for OCR and AI findings in Phase 4.

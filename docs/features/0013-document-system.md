# Document templates, numbering, generated PDFs

Migration: `supabase/migrations/0013_document_system.sql`  
Depends on: 0001, 0002, 0009

- Three document designs: Executive, Modern, Classic.
- Gap-free numbering series (QT-, INV-, CN-, RCT-, CNS-, ST-) allocated under a row lock.
- Register of every generated PDF with its hash; private `documents` and public `org-assets` storage buckets.

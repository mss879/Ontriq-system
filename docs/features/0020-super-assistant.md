# Command assistant and voice notes

Migration: `supabase/migrations/0020_super_assistant.sql`  
Depends on: 0019

- The Super Admin's command assistant (`/app/command`) uses the same route and tools as Ask Ontriq with the command tool set (create a client and invite their portal admin, send payment reminders for every invoice past N days) and Opus.
- Voice notes: `begin_voice_note(thread, mime, seconds)` (command assistant only; WebM, MP4, MP3, OGG or WAV; up to two minutes; the thread must be the person's own) returns a path in the private `documents` bucket. The `stt.transcribe` job writes the transcript back for the person to review before sending. Transcription uses OpenAI only when `STT_PROVIDER=openai` and `STT_API_KEY` are set; otherwise the browser's own dictation (Web Speech API) or typing.
- Audio is deleted after 30 days by `retention.purge`; transcripts stay with the conversation.
- Tests: `supabase/tests/0017_phase4.test.sql`.

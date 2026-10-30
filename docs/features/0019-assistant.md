# Ask Ontriq (staff assistant)

Migration: `supabase/migrations/0019_assistant.sql`  
Depends on: 0001, 0018

- Conversations (`assistant_threads`, `assistant_messages`) are private to their owner. `can_use_assistant('staff')` needs `ai.assistant`; `can_use_assistant('command')` needs the Super Admin.
- The chat route (`POST /api/assistant/chat`, server-sent events) stores the person's message, runs a streaming tool loop (`src/lib/ai/assistant/run.ts`: Sonnet for staff, Opus for the command assistant, at most 4 or 6 tool turns, a 22-second budget set by `ASSISTANT_BUDGET_MS`), then stores the reply. Every model call is priced in `ai_runs`; budgets and the kill switch in Settings → AI apply. Twelve messages a minute per person (twenty for the command assistant).
- Tools (`src/lib/ai/assistant/tools.ts`) read through the person's own client, so row level security decides what the assistant can see. Read tools return artifacts the chat draws (tables with "open in app", cards, metric tiles).
- Action tools never act: they leave a confirm card (`assistant_actions`, status `proposed`). Confirming (`confirmAssistantAction`) claims the card, re-checks the permission (and the Super Admin for command-only tools such as creating a client or sending reminders in bulk), runs it as the person and records the result. Reversible actions (reassign, hold or resume, a memory) can be undone for ten minutes. There are no delete tools.
- Memories (`assistant_memories`) are standing instructions the owner approved; approved ones are added to the system prompt.
- Messages and actions are written only by the server; owners may rename or archive threads and decide memories (column grants).
- Tests: `supabase/tests/0017_phase4.test.sql`.

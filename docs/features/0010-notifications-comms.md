# Notifications, email, SMS, tasks

Migration: `supabase/migrations/0010_notifications_comms.sql`  
Depends on: 0001, 0002, 0009

- In-app notifications with per-user preferences and quiet hours.
- Email and SMS outboxes; `queue_email` / `queue_sms` create the row and its delivery job in one transaction.
- Communications log, message templates (English, Sinhala, Tamil) and tasks.

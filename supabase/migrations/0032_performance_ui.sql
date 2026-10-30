-- =============================================================================
-- 0032_performance_ui.sql
-- Feature: the performance page and the Push button (plan §7.3, §7.4).
-- - send_nudge: the in-app notification now opens the dashboard banner, and
--   choosing the email channel really sends the email copy (before, it only
--   went when the person had email on for pushes in their preferences).
-- - auto_nudge_candidates: a second automatic push in a week escalates to
--   managers only when assignment_rules.auto_nudge.escalate is on (default on).
-- Depends on: 0010, 0017, 0021.
-- =============================================================================

create or replace function public.send_nudge(p_to uuid, p_message text, p_channels text[] default '{in_app}', p_items jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  v_items jsonb;
  v_id uuid;
  v_channels text[];
  v_note uuid;
begin
  if auth.uid() is not null and not (public.is_staff() and public.has_permission('staff.nudge')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_to = auth.uid() then raise exception 'you can''t push yourself' using errcode = '22023'; end if;
  if auth.uid() is not null and not exists (select 1 from public.memberships m where m.user_id = p_to and m.org_id = v_org and m.kind = 'staff' and m.status = 'active') then
    raise exception 'that person is not on the team' using errcode = 'P0002';
  end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'write a message' using errcode = '22023'; end if;
  v_items := coalesce(p_items, (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(public.staff_open_items(p_to)) x
                                 where (x ->> 'overdue')::boolean or (x ->> 'at_risk')::boolean));
  v_channels := (select coalesce(array_agg(distinct c), '{in_app}') from unnest(coalesce(p_channels, '{in_app}') || '{in_app}'::text[]) c
                  where c in ('in_app', 'email', 'sms'));
  insert into public.nudges (org_id, from_user, to_user, items, message, channels, auto)
  select coalesce(v_org, m.org_id), auth.uid(), p_to, v_items, left(trim(p_message), 2000), v_channels, auth.uid() is null
    from public.memberships m where m.user_id = p_to and m.kind = 'staff' limit 1
  returning id into v_id;
  -- Urgent: shows as a banner and bypasses quiet hours.
  perform public.notify_users(array[p_to], 'nudge', 'You''re behind on ' || jsonb_array_length(v_items) || ' item' ||
    case when jsonb_array_length(v_items) = 1 then '' else 's' end, left(trim(p_message), 300), '/app?nudge=' || v_id, true, 'nudge', v_id,
    (select org_id from public.nudges where id = v_id));
  if 'email' = any (v_channels) then
    select n.id into v_note from public.notifications n where n.entity_type = 'nudge' and n.entity_id = v_id and n.user_id = p_to limit 1;
    if v_note is not null then
      -- Same key as the preferences trigger (0021), so the email is never sent twice.
      perform public.enqueue_job('notify.email', jsonb_build_object('notification_id', v_note), 'notify.email:' || v_note,
                                 now(), null, 'notification', v_note, null, (select org_id from public.nudges where id = v_id), auth.uid());
    end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.send_nudge(uuid, text, text[], jsonb) from public, anon;
grant execute on function public.send_nudge(uuid, text, text[], jsonb) to authenticated, service_role;

create or replace function public.auto_nudge_candidates() returns table (org_id uuid, user_id uuid, name text, overdue int, escalate boolean)
language sql stable security definer set search_path = '' as $$
  select m.org_id, m.user_id, coalesce(p.full_name, p.email),
         (select count(*)::int from jsonb_array_elements(public.staff_open_items(m.user_id)) x where (x ->> 'overdue')::boolean),
         coalesce((ar.auto_nudge ->> 'escalate')::boolean, true)
           and exists (select 1 from public.nudges n where n.to_user = m.user_id and n.auto and n.created_at > now() - interval '7 days')
    from public.memberships m
    join public.assignment_rules ar on ar.org_id = m.org_id
    left join public.profiles p on p.id = m.user_id
   where m.kind = 'staff' and m.status = 'active' and coalesce((ar.auto_nudge ->> 'enabled')::boolean, false)
     and (select count(*) from jsonb_array_elements(public.staff_open_items(m.user_id)) x
           where (x ->> 'overdue')::boolean and (x ->> 'due_at')::timestamptz < now() - make_interval(hours => coalesce((ar.auto_nudge ->> 'hours')::int, 24)))
         >= coalesce((ar.auto_nudge ->> 'overdue_items')::int, 3)
     and not exists (select 1 from public.nudges n where n.to_user = m.user_id and n.auto and n.created_at > now() - interval '1 day')
$$;
revoke execute on function public.auto_nudge_candidates() from public, anon, authenticated;

update public.assignment_rules set auto_nudge = auto_nudge || '{"escalate": true}'::jsonb where not (auto_nudge ? 'escalate');
alter table public.assignment_rules alter column auto_nudge set default '{"enabled": false, "overdue_items": 3, "hours": 24, "escalate": true}'::jsonb;

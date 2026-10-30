-- 0027 Client package visibility, inline
-- 0005's packages_select asked client_can_use_package() about each row. That
-- function looks the package up again, and a function cannot see a row that
-- the same statement is inserting, so a client creating their own package
-- with RETURNING (as the portal does) was refused. The rule now reads the
-- row's own columns. Same meaning:
--   staff see every package; a client sees their own packages, and Ontriq's
--   active packages offered to everyone or to them.
-- Found by scripts/simulate.ts on the hosted project (2026-10-30). Depends on 0005.

drop policy if exists packages_select on public.packages;
create policy packages_select on public.packages for select to authenticated
  using (org_id = (select public.auth_org_id()) and (
    (select public.is_staff())
    or ((select public.is_client()) and (
         (owner_scope = 'client' and client_id = (select public.client_id_of_user()))
         or (owner_scope = 'org' and is_active and (
               visibility = 'all'
               or exists (select 1 from public.package_client_visibility v
                           where v.package_id = packages.id and v.client_id = (select public.client_id_of_user()))))
       ))
  ));

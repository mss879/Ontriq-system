"use client";

import { useTransition } from "react";
import { MoreHorizontal, RotateCw, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { changeRole, resendInvite, setMemberStatus } from "./actions";
import { ToneChip } from "@/components/cases/badges";
import { PersonAvatar } from "@/components/cases/person";
import { DataTable, HEAD_ROW, ListCard } from "@/components/layout/data-table";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tone } from "@/domain/workflow/stages";

export type TeamRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  status: "active" | "invited" | "suspended";
  since: string;
  inviteNote?: string;
};

type RoleOption = { id: string; key: string; name: string };

const STATUS: Record<Exclude<TeamRow["status"], "active">, { label: string; tone: Tone }> = {
  invited: { label: "Invited", tone: "info" },
  suspended: { label: "Suspended", tone: "neutral" },
};

export function TeamTable({ rows, roles, viewerId, viewerIsSuperAdmin }: { rows: TeamRow[]; roles: RoleOption[]; viewerId: string; viewerIsSuperAdmin: boolean }) {
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; devLink?: string }>, success: string) =>
    start(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(success, result.devLink ? { description: "Email isn't configured; the link was logged on the server." } : undefined);
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });

  const isLocked = (row: TeamRow) => row.userId === viewerId || (row.roleKey === "super_admin" && !viewerIsSuperAdmin);

  const roleControl = (row: TeamRow, locked: boolean) =>
    locked ? (
      <span className="text-sm">{row.roleName}</span>
    ) : (
      <Select
        value={row.roleId}
        onValueChange={(roleId) => run(() => changeRole({ membershipId: row.membershipId, roleId }), "Designation updated")}
      >
        <SelectTrigger size="sm" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles
            .filter((r) => r.key !== "super_admin" || viewerIsSuperAdmin)
            .map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    );

  const rowActions = (row: TeamRow, locked: boolean) =>
    locked ? null : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name || row.email}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {row.status === "invited" ? (
            <DropdownMenuItem onSelect={() => run(() => resendInvite(row.membershipId), "Invitation resent")}>
              <RotateCw /> Resend invitation
            </DropdownMenuItem>
          ) : null}
          {row.status === "suspended" ? (
            <DropdownMenuItem onSelect={() => run(() => setMemberStatus({ membershipId: row.membershipId, status: "active" }), "Access restored")}>
              <ShieldCheck /> Restore access
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                run(
                  () => setMemberStatus({ membershipId: row.membershipId, status: "suspended" }),
                  row.status === "invited" ? "Invitation revoked" : "Access suspended",
                )
              }
            >
              <ShieldOff /> {row.status === "invited" ? "Revoke invitation" : "Suspend access"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  const status = (row: TeamRow) =>
    row.status === "active" ? <span className="text-sm text-muted-foreground">Active</span> : <ToneChip tone={STATUS[row.status].tone}>{STATUS[row.status].label}</ToneChip>;

  return (
    <DataTable
      header={
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <p className="text-sm font-semibold">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
          <p className="text-xs text-muted-foreground">
            {rows.filter((r) => r.status === "active").length} active · {rows.filter((r) => r.status === "invited").length} invited
          </p>
        </div>
      }
      cards={rows.map((row) => (
        <ListCard
          key={row.membershipId}
          title={
            <span className="flex min-w-0 items-center gap-3">
              <PersonAvatar id={row.userId} name={row.name || row.email} />
              <span className="min-w-0 truncate">
                {row.name || row.email}
                {row.userId === viewerId ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
              </span>
            </span>
          }
          aside={rowActions(row, isLocked(row))}
        >
          {roleControl(row, isLocked(row))}
          {status(row)}
          {row.inviteNote ? <p className="w-full text-xs text-muted-foreground">{row.inviteNote}</p> : null}
        </ListCard>
      ))}
    >
      <Table>
        <TableHeader>
          <TableRow className={HEAD_ROW}>
            <TableHead className="h-9 pl-5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Person</TableHead>
            <TableHead className="h-9 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Designation</TableHead>
            <TableHead className="h-9 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Status</TableHead>
            <TableHead className="hidden h-9 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase md:table-cell">Since</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSelf = row.userId === viewerId;
            return (
              <TableRow key={row.membershipId} data-pending={pending || undefined}>
                <TableCell className="py-3 pl-5">
                  <div className="flex items-center gap-3">
                    <PersonAvatar id={row.userId} name={row.name || row.email} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {row.name || row.email}
                        {isSelf ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {roleControl(row, isLocked(row))}
                </TableCell>
                <TableCell>
                  {status(row)}
                  {row.inviteNote ? <p className="mt-1 text-xs text-muted-foreground">{row.inviteNote}</p> : null}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{row.since}</TableCell>
                <TableCell className="pr-3 text-right">
                  {rowActions(row, isLocked(row))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTable>
  );
}

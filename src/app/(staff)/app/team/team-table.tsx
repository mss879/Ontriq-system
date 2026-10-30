"use client";

import { useTransition } from "react";
import { MoreHorizontal, RotateCw, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { changeRole, resendInvite, setMemberStatus } from "./actions";
import { initials } from "@/components/layout/user-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

const STATUS: Record<TeamRow["status"], { label: string; className: string; dot: string }> = {
  active: { label: "Active", className: "bg-success/10 text-success ring-1 ring-success/20", dot: "bg-success" },
  invited: { label: "Invited", className: "bg-info/10 text-info ring-1 ring-info/20", dot: "bg-info" },
  suspended: { label: "Suspended", className: "bg-muted text-muted-foreground ring-1 ring-border", dot: "bg-muted-foreground/60" },
};

const AVATAR_TONES = [
  "bg-[linear-gradient(135deg,#f78f1e,#f75834)]",
  "bg-[linear-gradient(135deg,#0c5a9a,#0098f3)]",
  "bg-[linear-gradient(135deg,#0a1a2f,#0c5a9a)]",
  "bg-[linear-gradient(135deg,#f75834,#0c5a9a)]",
];

function toneFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

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

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <p className="text-sm font-semibold">
          {rows.length} {rows.length === 1 ? "person" : "people"}
        </p>
        <p className="text-xs text-muted-foreground">
          {rows.filter((r) => r.status === "active").length} active · {rows.filter((r) => r.status === "invited").length} invited
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
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
            const locked = isSelf || (row.roleKey === "super_admin" && !viewerIsSuperAdmin);
            return (
              <TableRow key={row.membershipId} data-pending={pending || undefined}>
                <TableCell className="py-3 pl-5">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-9 rounded-xl">
                      <AvatarFallback className={`rounded-xl text-xs font-semibold text-white ${toneFor(row.userId)}`}>{initials(row.name, row.email)}</AvatarFallback>
                    </Avatar>
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
                  {locked ? (
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
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS[row.status].className}>
                    <span className={`size-1.5 rounded-full ${STATUS[row.status].dot}`} />
                    {STATUS[row.status].label}
                  </Badge>
                  {row.inviteNote ? <p className="mt-1 text-xs text-muted-foreground">{row.inviteNote}</p> : null}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{row.since}</TableCell>
                <TableCell className="pr-3 text-right">
                  {locked ? null : (
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
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

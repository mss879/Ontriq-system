"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addCaseCheck } from "../../actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

/** Add a check to an open case, including a second Education check for another qualification. */
export function AddCheck({ caseId, types }: { caseId: string; types: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus /> Add a check
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setType("");
            setLabel("");
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!type) return setError("Choose a check.");
              start(async () => {
                const r = await addCaseCheck(caseId, type, label);
                if (r.ok) {
                  toast.success("Check added");
                  setOpen(false);
                  setType("");
                  setLabel("");
                  setError(null);
                } else setError(r.error);
              });
            }}
          >
            <DialogHeader className="mb-4">
              <DialogTitle>Add a check</DialogTitle>
              <DialogDescription>Its documents join the case. To cover another qualification or role, add the same check again with its own name.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="add-check-type">Check</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="add-check-type" className="w-full">
                    <SelectValue placeholder="Choose a check" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-check-label">Name on this case (optional)</Label>
                <Input id="add-check-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Education: A/L" maxLength={120} />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter className="mt-5">
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null} Add check
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

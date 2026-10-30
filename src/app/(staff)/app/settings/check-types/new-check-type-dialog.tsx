"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createCheckType } from "./actions";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const toKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1")
    .slice(0, 48);

export function NewCheckTypeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setName("");
          setKey("");
          setKeyTouched(false);
          setDescription("");
          setErrors({});
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className="h-9 px-3.5">
          <Plus /> New check type
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await createCheckType({ name, key, description });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                setError(r.fieldErrors ? null : r.error);
                return;
              }
              toast.success(`${name} created as a draft`);
              setOpen(false);
              router.push(`/app/settings/check-types/${r.id}`);
            });
          }}
        >
          <DialogHeader className="mb-5">
            <DialogTitle>New check type</DialogTitle>
            <DialogDescription>It starts as a draft with two fields. Build it, then publish it to use it in packages and cases.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={pending}>
            <FieldGroup>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <TextField
                name="name"
                label="Name"
                autoFocus
                placeholder="e.g. Professional licence"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyTouched) setKey(toKey(e.target.value));
                }}
                errors={errors.name}
              />
              <TextField
                name="key"
                label="Key"
                value={key}
                inputClassName="font-mono"
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value);
                }}
                description="A permanent internal name. It can't change later."
                errors={errors.key}
              />
              <TextField name="description" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} errors={errors.description} />
            </FieldGroup>
          </fieldset>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

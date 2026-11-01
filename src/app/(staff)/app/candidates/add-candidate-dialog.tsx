"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { addCandidate } from "./actions";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

/** Add a person by hand, for a client, before any case exists. */
export function AddCandidateDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Add candidate
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">{open ? <AddCandidateForm clients={clients} onCancel={() => setOpen(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function AddCandidateForm({ clients, onCancel }: { clients: { id: string; name: string }[]; onCancel: () => void }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [fullName, setFullName] = useState("");
  const [nic, setNic] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const r = await addCandidate({ clientId, fullName, nic, email, phone, address });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.fieldErrors ? null : r.error);
        return;
      }
      if (r.reused) toast.info("This person is already on file", { description: "Opening their record. Nothing was changed." });
      else toast.success("Candidate added");
      router.push(`/app/candidates/${r.id}`);
    });
  };

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Add a candidate</DialogTitle>
        <DialogDescription>Save someone now and start their case when you&apos;re ready.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="my-5 gap-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <Field data-invalid={errors.clientId ? true : undefined}>
          <FieldLabel htmlFor="candidate-client">Client</FieldLabel>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="candidate-client" className="w-full" aria-invalid={errors.clientId ? true : undefined}>
              <SelectValue placeholder="Choose a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors.clientId?.map((message) => ({ message }))} />
        </Field>
        <TextField name="fullName" label="Full name" autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} errors={errors.fullName} />
        <TextField name="nic" label="NIC" description="If they're already on file, this finds them." value={nic} onChange={(e) => setNic(e.target.value)} errors={errors.nic} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} errors={errors.email} />
          <TextField name="phone" label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} errors={errors.phone} />
        </div>
        <TextField name="address" label="Address" value={address} onChange={(e) => setAddress(e.target.value)} errors={errors.address} />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Add candidate
        </Button>
      </DialogFooter>
    </form>
  );
}

"use client";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Props = React.ComponentProps<typeof Input> & {
  name: string;
  label: string;
  description?: string;
  errors?: string[];
  labelAside?: React.ReactNode;
  inputClassName?: string;
};

/** Label + input + inline error, wired for Server Action field errors. */
export function TextField({ name, label, description, errors, labelAside, id, className, inputClassName, ...input }: Props) {
  const fieldId = id ?? `field-${name}`;
  const invalid = Boolean(errors?.length);
  return (
    <Field data-invalid={invalid || undefined} className={className}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
        {labelAside}
      </div>
      <Input id={fieldId} name={name} aria-invalid={invalid || undefined} className={inputClassName} {...input} />
      {description && !invalid ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}

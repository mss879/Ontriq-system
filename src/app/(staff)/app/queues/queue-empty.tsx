import { Inbox } from "lucide-react";
import { Surface } from "@/components/admin/surface";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** An empty queue: said once, plainly, in the same card a full one would use. */
export function QueueEmpty({ text, title = "Nothing here" }: { text: string; title?: string }) {
  return (
    <Surface>
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{text}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Surface>
  );
}

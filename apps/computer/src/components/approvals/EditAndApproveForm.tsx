import { useState } from "react";
import { Button, Input, Label, Textarea } from "@thinkwork/ui";
import type { EmailDraft } from "@/components/approvals/approval-types";

interface EditAndApproveFormProps {
  draft: EmailDraft;
  isSubmitting?: boolean;
  onApprove: (draft: EmailDraft) => void;
}

export function EditAndApproveForm({
  draft,
  isSubmitting = false,
  onApprove,
}: EditAndApproveFormProps) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApprove({
          to: draft.to,
          subject: subject.trim(),
          body: body.trim(),
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="approval-email-to">To</Label>
        <Input id="approval-email-to" value={draft.to ?? ""} readOnly />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="approval-email-subject">Subject</Label>
        <Input
          id="approval-email-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="approval-email-body">Draft</Label>
        <Textarea
          id="approval-email-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-40 resize-y"
        />
      </div>
      <Button
        type="submit"
        className="justify-self-start"
        disabled={isSubmitting}
      >
        Edit and approve
      </Button>
    </form>
  );
}

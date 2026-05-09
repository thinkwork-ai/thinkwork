import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditAndApproveForm } from "@/components/approvals/EditAndApproveForm";

afterEach(cleanup);

describe("EditAndApproveForm", () => {
  it("submits the edited draft", () => {
    const onApprove = vi.fn();
    render(
      <EditAndApproveForm
        draft={{
          to: "buyer@example.com",
          subject: "Hello",
          body: "Draft",
        }}
        onApprove={onApprove}
      />,
    );

    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Updated subject" },
    });
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "Updated body" },
    });
    fireEvent.click(screen.getByRole("button", { name: /edit and approve/i }));

    expect(onApprove).toHaveBeenCalledWith({
      to: "buyer@example.com",
      subject: "Updated subject",
      body: "Updated body",
    });
  });
});

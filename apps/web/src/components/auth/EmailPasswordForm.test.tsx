import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EmailPasswordForm } from "./EmailPasswordForm";

const signIn = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ signIn }),
}));

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
}

describe("EmailPasswordForm", () => {
  beforeEach(() => {
    signIn.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("signs in with trimmed email and password", async () => {
    signIn.mockResolvedValue(undefined);
    render(<EmailPasswordForm />);

    fillCredentials(" user@example.com ", "Temp1234");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith("user@example.com", "Temp1234"),
    );
  });

  it("shows a friendly message for bad credentials", async () => {
    signIn.mockRejectedValue(
      Object.assign(new Error("Incorrect username or password."), {
        code: "NotAuthorizedException",
      }),
    );
    render(<EmailPasswordForm />);

    fillCredentials("user@example.com", "wrong");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Incorrect email or password.",
    );
  });

  it("switches to the new-password step on NEW_PASSWORD_REQUIRED and completes the challenge", async () => {
    signIn.mockRejectedValueOnce(
      Object.assign(new Error("New password required"), {
        code: "NewPasswordRequired",
      }),
    );
    signIn.mockResolvedValueOnce(undefined);
    render(<EmailPasswordForm />);

    fillCredentials("invitee@example.com", "Temp1234");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("Set a new password");

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "MyNewPass1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "MyNewPass1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Set password and sign in" }),
    );

    await waitFor(() =>
      expect(signIn).toHaveBeenLastCalledWith(
        "invitee@example.com",
        "Temp1234",
        "MyNewPass1",
      ),
    );
  });

  it("rejects mismatched new passwords without calling signIn again", async () => {
    signIn.mockRejectedValueOnce(
      Object.assign(new Error("New password required"), {
        code: "NewPasswordRequired",
      }),
    );
    render(<EmailPasswordForm />);

    fillCredentials("invitee@example.com", "Temp1234");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("Set a new password");

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "MyNewPass1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "Different1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Set password and sign in" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Passwords do not match.",
    );
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("reports an expired temporary password distinctly", async () => {
    signIn.mockRejectedValue(
      Object.assign(
        new Error(
          "Temporary password has expired and must be reset by an administrator.",
        ),
        { code: "NotAuthorizedException" },
      ),
    );
    render(<EmailPasswordForm />);

    fillCredentials("invitee@example.com", "Temp1234");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Your temporary password has expired. Ask your administrator for a new one.",
    );
  });
});

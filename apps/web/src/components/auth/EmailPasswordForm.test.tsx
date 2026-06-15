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
const authMocks = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  confirmForgotPassword: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ signIn }),
}));

vi.mock("@/lib/auth", () => authMocks);

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
    authMocks.forgotPassword.mockReset();
    authMocks.confirmForgotPassword.mockReset();
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
      "Your temporary password has expired. Use Reset password to set a new one.",
    );
  });

  it("requests a reset code with neutral copy and confirms a new password", async () => {
    authMocks.forgotPassword.mockResolvedValue(undefined);
    authMocks.confirmForgotPassword.mockResolvedValue(undefined);
    render(<EmailPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: " manual@example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "manual@example.com",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));

    await waitFor(() =>
      expect(authMocks.forgotPassword).toHaveBeenCalledWith(
        "manual@example.com",
      ),
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      "If this account can reset passwords",
    );

    fireEvent.change(screen.getByLabelText("Reset code"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "MyNewPass1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "MyNewPass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() =>
      expect(authMocks.confirmForgotPassword).toHaveBeenCalledWith(
        "manual@example.com",
        "123456",
        "MyNewPass1",
      ),
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      "Password reset complete",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("neutralizes unknown reset request accounts without confirming existence", async () => {
    authMocks.forgotPassword.mockRejectedValue(
      Object.assign(new Error("User does not exist."), {
        code: "UserNotFoundException",
      }),
    );
    render(<EmailPasswordForm />);

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "missing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "If this account can reset passwords",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Reset code")).toBeTruthy();
  });

  it("surfaces reset code delivery failures", async () => {
    authMocks.forgotPassword.mockRejectedValue(
      Object.assign(new Error("Email delivery failed."), {
        code: "CodeDeliveryFailureException",
      }),
    );
    render(<EmailPasswordForm />);

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "We couldn't send a reset code.",
    );
    expect(screen.queryByLabelText("Reset code")).toBeNull();
  });

  it("rejects mismatched reset passwords without confirming the reset", async () => {
    authMocks.forgotPassword.mockResolvedValue(undefined);
    render(<EmailPasswordForm />);

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "manual@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByLabelText("Reset code");

    fireEvent.change(screen.getByLabelText("Reset code"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "MyNewPass1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "Different1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Passwords do not match.",
    );
    expect(authMocks.confirmForgotPassword).not.toHaveBeenCalled();
  });

  it("maps reset confirmation code and password-policy failures", async () => {
    authMocks.forgotPassword.mockResolvedValue(undefined);
    authMocks.confirmForgotPassword
      .mockRejectedValueOnce(
        Object.assign(new Error("Invalid verification code provided."), {
          code: "CodeMismatchException",
        }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("Password did not conform with policy."), {
          code: "InvalidPasswordException",
        }),
      );
    render(<EmailPasswordForm />);

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "manual@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByLabelText("Reset code");

    fireEvent.change(screen.getByLabelText("Reset code"), {
      target: { value: "111111" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "weakpass" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "weakpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The reset code is invalid.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Password did not conform with policy.",
    );
  });

  it("lets the user change email, resend, and return without stale reset fields", async () => {
    authMocks.forgotPassword.mockResolvedValue(undefined);
    render(<EmailPasswordForm />);

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "first@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByLabelText("Reset code");
    fireEvent.change(screen.getByLabelText("Reset code"), {
      target: { value: "123456" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    await waitFor(() =>
      expect(authMocks.forgotPassword).toHaveBeenCalledTimes(2),
    );
    expect(
      (screen.getByLabelText("Reset code") as HTMLInputElement).value,
    ).toBe("");

    fireEvent.change(screen.getByLabelText("Reset code"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "first@example.com",
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "second@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "second@example.com",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(screen.queryByLabelText("Reset code")).toBeNull();
  });
});

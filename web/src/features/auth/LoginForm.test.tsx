import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import type * as ApiModule from "@/lib/api";
import type { User } from "@/lib/types";

const login = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return {
    ...mod,
    api: { ...mod.api, auth: { ...mod.api.auth, login: (...a: unknown[]) => login(...a) } },
  };
});

const { ApiError } = await import("@/lib/api");
const { LoginForm } = await import("./LoginForm");

const USER: User = {
  id: "01J0000000000000000000000A",
  username: "bob",
  role: "admin",
  totp_enabled: true,
  disabled: false,
  created_at: 0,
  last_login_at: null,
};

describe("login form", () => {
  beforeEach(() => login.mockReset());

  it("switches to the TOTP step on totp_required and sends the code", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    login
      .mockRejectedValueOnce(new ApiError("totp_required", "code required", 401))
      .mockResolvedValueOnce(USER);

    renderWithClient(<LoginForm onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText("Логин"), "bob");
    await user.type(screen.getByLabelText("Пароль"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    const code = await screen.findByLabelText("Код TOTP");
    expect(screen.queryByLabelText("Пароль")).not.toBeInTheDocument();
    expect(login).toHaveBeenLastCalledWith({ username: "bob", password: "correct horse" });

    await user.type(code, "12a3456");
    expect(code).toHaveValue("123456");
    await user.click(screen.getByRole("button", { name: "Подтвердить" }));

    expect(login).toHaveBeenLastCalledWith({
      username: "bob",
      password: "correct horse",
      totp: "123456",
    });
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0]![0]).toEqual(USER);
  });

  it("shows an error for wrong credentials and stays on the password step", async () => {
    const user = userEvent.setup();
    login.mockRejectedValueOnce(new ApiError("unauthorized", "invalid", 401));
    renderWithClient(<LoginForm onSuccess={vi.fn()} />);
    await user.type(screen.getByLabelText("Логин"), "alice");
    await user.type(screen.getByLabelText("Пароль"), "nope");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный логин или пароль");
    expect(screen.getByLabelText("Пароль")).toBeInTheDocument();
  });

  it("reports a wrong TOTP code without leaving the TOTP step", async () => {
    const user = userEvent.setup();
    login
      .mockRejectedValueOnce(new ApiError("totp_required", "code required", 401))
      .mockRejectedValueOnce(new ApiError("totp_required", "bad code", 401));
    renderWithClient(<LoginForm onSuccess={vi.fn()} />);
    await user.type(screen.getByLabelText("Логин"), "bob");
    await user.type(screen.getByLabelText("Пароль"), "pw");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await user.type(await screen.findByLabelText("Код TOTP"), "000000");
    await user.click(screen.getByRole("button", { name: "Подтвердить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный код");
    expect(screen.getByLabelText("Код TOTP")).toBeInTheDocument();
  });
});

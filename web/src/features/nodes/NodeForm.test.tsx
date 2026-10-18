import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import type { CreateNodeInput } from "@/lib/types";
import { NodeForm } from "./NodeForm";
import type { NodeFormValues } from "./validation";

function Harness({ onSubmit }: { onSubmit: (i: CreateNodeInput) => void }) {
  const [values, setValues] = React.useState<NodeFormValues>({
    name: "",
    addr: "",
    node_key: "",
    labels: "",
  });
  return (
    <NodeForm
      values={values}
      onChange={setValues}
      onSubmit={onSubmit}
      onCancel={() => {}}
      pending={false}
      serverError={null}
      submitLabel="Добавить и проверить"
    />
  );
}

const KEY = "ABCDEF0123456789".repeat(4);

describe("add-node form", () => {
  it("shows validation errors and does not submit invalid input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Адрес"), "no-port");
    await user.type(screen.getByLabelText("Пин ноды"), "abc");
    await user.click(screen.getByRole("button", { name: "Добавить и проверить" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Имя — от 1 до 64 символов")).toBeInTheDocument();
    expect(screen.getByText(/Ожидается host:port/)).toBeInTheDocument();
    expect(screen.getByText("Пин — 64 шестнадцатеричных символа")).toBeInTheDocument();
    expect(screen.getByLabelText("Адрес")).toHaveAttribute("aria-invalid", "true");
  });

  it("submits normalised values and previews the fingerprint", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Имя"), " msk-1 ");
    await user.type(screen.getByLabelText("Адрес"), "msk.example.org:7443");
    await user.type(screen.getByLabelText("Пин ноды"), KEY);
    await user.type(screen.getByLabelText("Метки"), "env=prod, region=ru");

    expect(screen.getByTestId("fingerprint-preview")).toHaveTextContent(
      /^ABCD-EF01-2345-6789-ABCD/,
    );

    await user.click(screen.getByRole("button", { name: "Добавить и проверить" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "msk-1",
      addr: "msk.example.org:7443",
      node_key: KEY.toLowerCase(),
      labels: { env: "prod", region: "ru" },
    });
  });
});

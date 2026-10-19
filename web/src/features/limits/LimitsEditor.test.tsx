import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Setting, Settings } from "@/lib/types";
import { LimitsEditor } from "./LimitsEditor";

const MIB = 1024 * 1024;

const CATALOG: Setting[] = [
  {
    key: "quota_max_bytes_per_queue",
    env: "QUOTA_MAX_BYTES_PER_QUEUE",
    group: "messages",
    unit: "bytes",
    scope: "hot",
    min: 1024,
    max: 1024 ** 4,
    zero_unlimited: true,
    default: 64 * MIB,
    summary: "Потолок объёма одной очереди",
  },
  {
    key: "ice_credential_ttl_secs",
    env: "ICE_CREDENTIAL_TTL_SECS",
    group: "calls",
    unit: "seconds",
    scope: "hot",
    min: 300,
    max: 86_400,
    zero_unlimited: false,
    default: 7200,
    summary: "Срок временной учётки TURN",
  },
  {
    key: "blob_chunk_max_bytes",
    env: "BLOB_CHUNK_MAX_BYTES",
    group: "blobs",
    unit: "bytes",
    scope: "restart",
    min: 4096,
    max: 64 * MIB,
    zero_unlimited: false,
    default: MIB,
    summary: "Потолок куска загрузки",
  },
  {
    key: "queue_addressing_enabled",
    env: "QUEUE_ADDRESSING_ENABLED",
    group: "messages",
    unit: "flag",
    scope: "restart",
    min: 0,
    max: 1,
    zero_unlimited: false,
    default: 1,
    summary: "Адресация по очередям",
    since: "0.8.0",
  },
];

function Harness({ initial, spy }: { initial: Settings; spy: (v: Settings) => void }) {
  const [values, setValues] = React.useState<Settings>(initial);
  return (
    <TooltipProvider>
      <LimitsEditor
        catalog={CATALOG}
        values={values}
        onChange={(v) => {
          spy(v);
          setValues(v);
        }}
        layer="profile"
      />
    </TooltipProvider>
  );
}

describe("LimitsEditor", () => {
  it("groups settings and shows defaults with scope badges", () => {
    render(<Harness initial={{}} spy={() => {}} />);
    expect(screen.getByRole("heading", { name: "Отправка и очереди" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Звонки" })).toBeInTheDocument();
    expect(screen.getByText("64 MiB")).toBeInTheDocument();
    expect(screen.getAllByText("после перезапуска")).toHaveLength(2);
  });

  it("sets a value in another unit and validates it against min/max", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={{}} spy={spy} />);
    await user.click(screen.getByRole("button", { name: "Задать ice_credential_ttl_secs" }));
    expect(spy).toHaveBeenLastCalledWith({ ice_credential_ttl_secs: 7200 });

    const input = screen.getByLabelText("Срок временной учётки TURN");
    expect(input).toHaveValue("2");
    await user.clear(input);
    await user.type(input, "4");
    expect(spy).toHaveBeenLastCalledWith({ ice_credential_ttl_secs: 4 * 3600 });

    await user.clear(input);
    await user.type(input, "48");
    expect(spy).toHaveBeenLastCalledWith({ ice_credential_ttl_secs: 48 * 3600 });
    expect(screen.getByRole("alert")).toHaveTextContent("От 5 мин до 1 дн");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("toggles «no limit» to 0 and back to the previous value", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={{ quota_max_bytes_per_queue: 128 * MIB }} spy={spy} />);
    const toggle = screen.getByRole("switch", {
      name: "без ограничения: quota_max_bytes_per_queue",
    });
    await user.click(toggle);
    expect(spy).toHaveBeenLastCalledWith({ quota_max_bytes_per_queue: 0 });
    expect(screen.getByText("∞")).toBeInTheDocument();
    await user.click(toggle);
    expect(spy).toHaveBeenLastCalledWith({ quota_max_bytes_per_queue: 128 * MIB });
  });

  it("edits a flag with a switch and marks the node version it needs", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={{}} spy={spy} />);
    expect(screen.getByText("включено")).toBeInTheDocument();
    expect(screen.getByText("нода ≥ 0.8.0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Задать queue_addressing_enabled" }));
    expect(spy).toHaveBeenLastCalledWith({ queue_addressing_enabled: 1 });
    const toggle = screen.getByRole("switch", { name: "Адресация по очередям" });
    expect(toggle).toBeChecked();
    expect(
      screen.queryByRole("textbox", { name: "Адресация по очередям" }),
    ).not.toBeInTheDocument();

    await user.click(toggle);
    expect(spy).toHaveBeenLastCalledWith({ queue_addressing_enabled: 0 });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("выключено")).toBeInTheDocument();
  });

  it("resets a value to the default and filters by search", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={{ blob_chunk_max_bytes: 2 * MIB }} spy={spy} />);
    await user.click(
      screen.getByRole("button", { name: "Сбросить к умолчанию: blob_chunk_max_bytes" }),
    );
    expect(spy).toHaveBeenLastCalledWith({});

    await user.type(screen.getByLabelText("Поиск по ключу и описанию"), "turn");
    expect(screen.queryByRole("heading", { name: "Отправка и очереди" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Звонки" })).toBeInTheDocument();
  });
});

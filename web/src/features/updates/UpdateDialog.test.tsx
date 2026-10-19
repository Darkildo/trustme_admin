import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import type * as ApiModule from "@/lib/api";
import type { NodeUpdate, NodeVersions, ReleasesView } from "@/lib/types";

const startUpdate = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      nodes: { ...mod.api.nodes, startUpdate: (...a: unknown[]) => startUpdate(...a) },
    },
  };
});

const { UpdateDialog, UpdateForm } = await import("./UpdateDialog");

const NODE = { id: "01J0000000000000000000NODE", name: "msk-1" };

const current = (p: Partial<NodeVersions> = {}): NodeVersions => ({
  managed: true,
  agent: { arch: "aarch64", tmnode_version: "0.7.0" },
  node_image: "ghcr.io/darkildo/trustme_backend:v0.7.0",
  node_image_source: "agent",
  node_version: "0.7.0",
  tmnode_version: "0.7.0",
  supports_updates: true,
  min_agent_version: "0.3.0",
  agent_upgrade_command:
    "curl -fsSL https://raw.githubusercontent.com/Darkildo/trustme_backend/stable/deploy/install.sh | sudo sh -s -- agent-upgrade",
  ...p,
});

const RELEASES: ReleasesView = {
  enabled: true,
  repo: "Darkildo/trustme_backend",
  latest: "0.7.1",
  releases: [
    {
      version: "0.7.1",
      tag: "v0.7.1",
      published_at: null,
      url: "",
      tmnode: { x86_64: true, aarch64: true },
    },
    {
      version: "0.6.0",
      tag: "v0.6.0",
      published_at: null,
      url: "",
      tmnode: { x86_64: true, aarch64: false },
    },
  ],
};

function form(view: ReleasesView = RELEASES, versions = current()) {
  const onDone = vi.fn();
  renderWithClient(<UpdateForm node={NODE} current={versions} releases={view} onDone={onDone} />);
  return onDone;
}

describe("диалог обновления", () => {
  beforeEach(() => startUpdate.mockReset());

  it("по умолчанию — последняя версия, нода и агент, с предупреждением о перерыве", async () => {
    const user = userEvent.setup();
    startUpdate.mockResolvedValue({ id: "u" } as NodeUpdate);
    const onDone = form();
    expect(screen.getByRole("combobox", { name: "Версия" })).toHaveTextContent("v0.7.1");
    expect(screen.getByRole("checkbox", { name: /Нода/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Агент tmnode/ })).toBeChecked();
    expect(screen.getByText(/переподключатся сами за несколько секунд/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Обновить" }));
    expect(startUpdate).toHaveBeenCalledWith(NODE.id, {
      node_version: "0.7.1",
      tmnode_version: "0.7.1",
      tmnode_sha256: undefined,
      allow_downgrade: undefined,
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("понижение — только с явной галочкой, бинаря под архитектуру нет — агент не трогаем", async () => {
    const user = userEvent.setup();
    startUpdate.mockResolvedValue({ id: "u" } as NodeUpdate);
    form();
    await user.click(screen.getByRole("combobox", { name: "Версия" }));
    await user.click(await screen.findByRole("option", { name: /v0\.6\.0/ }));

    const agent = screen.getByRole("checkbox", { name: /Агент tmnode/ });
    expect(agent).toBeDisabled();
    expect(agent).not.toBeChecked();
    expect(screen.getByText(/нет tmnode под aarch64/)).toBeInTheDocument();
    expect(screen.getByText(/Откат данных не гарантирован/)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Обновить" });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /Понизить/ }));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(startUpdate).toHaveBeenCalledWith(NODE.id, {
      node_version: "0.6.0",
      tmnode_version: undefined,
      tmnode_sha256: undefined,
      allow_downgrade: true,
    });
  });

  it("ничего нового — кнопка неактивна", async () => {
    const user = userEvent.setup();
    form(RELEASES, current({ node_version: "0.7.1", tmnode_version: "0.7.1" }));
    expect(screen.getByText("Эта версия уже стоит")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Нода/ }));
    await user.click(screen.getByRole("checkbox", { name: /Агент tmnode/ }));
    expect(screen.getByRole("button", { name: "Обновить" })).toBeDisabled();
  });

  it("релизы выключены — версия и хэш вручную", async () => {
    const user = userEvent.setup();
    startUpdate.mockResolvedValue({ id: "u" } as NodeUpdate);
    form({ enabled: false, repo: null, latest: null, releases: [] });
    expect(screen.getByText("Релизы выключены")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Версия X.Y.Z"), "0.8");
    expect(screen.getByText("Версия — три числа: X.Y.Z")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Версия X.Y.Z"), ".0");
    const submit = screen.getByRole("button", { name: "Обновить" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("SHA-256 tmnode-aarch64-linux"), "AB".repeat(32));
    await user.click(submit);
    expect(startUpdate).toHaveBeenCalledWith(NODE.id, {
      node_version: "0.8.0",
      tmnode_version: "0.8.0",
      tmnode_sha256: "ab".repeat(32),
      allow_downgrade: undefined,
    });
  });

  it("агент до 0.3.0 — вместо кнопки команда agent-upgrade с копированием", () => {
    renderWithClient(
      <UpdateDialog
        node={NODE}
        current={current({ supports_updates: false, tmnode_version: "0.2.0" })}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText(/Агент tmnode 0\.2\.0 не умеет обновляться/)).toBeInTheDocument();
    expect(screen.getByText(/agent-upgrade/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скопировать" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Обновить" })).toBeNull();
  });
});

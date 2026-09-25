import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { imageModelsForProvider, IMAGE_PROVIDER_OPTIONS } from "@/lib/image-generation/registry";

vi.mock("@/components/admin/cabi-reference-panel", () => ({
  CabiReferencePanel: (props: { selectedModel?: string }) => <div data-testid="cabi-reference-panel" data-model={props.selectedModel ?? ""} />,
}));

import { AdminImagesPanel } from "@/components/admin/admin-images-panel";

const payload = {
  settings: {
    enabled: true,
    provider: "together",
    model: "Qwen/Qwen-Image-2.0",
    defaultAspectRatio: "1:1",
    defaultQuality: "standard",
    dailyLimit: 5,
    allowGuestGeneration: false,
    hasApiKey: true,
    keyLastFour: "7890",
  },
  providers: [...IMAGE_PROVIDER_OPTIONS],
  models: imageModelsForProvider("together"),
};

const requestBodies: Array<Record<string, unknown>> = [];

beforeEach(() => {
  requestBodies.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/admin/images")) return new Response(JSON.stringify(payload), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
});

describe("owner image settings panel", () => {
  it("renders the curated provider/model controls without URL or free-text model inputs", async () => {
    render(<AdminImagesPanel />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Provider" })).toBeInTheDocument());

    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveValue("together");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("Qwen/Qwen-Image-2.0");
    expect(screen.getByRole("option", { name: /Qwen Image 2\.0 · Recommended/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Qwen Image 2\.0 Pro · Highest Quality/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Qwen Image · Budget/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /FLUX Kontext Pro · Character Consistency/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Together AI API Key")).toHaveAttribute("type", "password");
    expect(screen.queryByLabelText(/Base URL/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenAI-compatible/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Model" })).not.toBeInTheDocument();
    expect(screen.getByText(/Reference ready/i)).toBeInTheDocument();
    expect(screen.getByText("Seed").parentElement).toHaveAttribute("data-capability", "supported");
  });

  it("updates the live reference capability preview when the model changes", async () => {
    render(<AdminImagesPanel />);
    const model = await screen.findByRole("combobox", { name: "Model" });
    expect(screen.getByText("Seed").parentElement).toHaveAttribute("data-capability", "supported");
    fireEvent.change(model, { target: { value: "Qwen/Qwen-Image" } });
    expect(screen.getByText("Seed").parentElement).toHaveAttribute("data-capability", "unsupported");
    expect(screen.getAllByText("Text to Image").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reference Images").length).toBeGreaterThan(0);
    // Unsupported capabilities use a Lucide Minus icon rather than a Unicode
    // glyph, so the assertion is on the exported state instead of the character.
    expect(document.querySelectorAll("[data-capability='unsupported']").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-capability='supported']").length).toBeGreaterThan(0);
    expect(screen.getByTestId("cabi-reference-panel")).toHaveAttribute("data-model", "Qwen/Qwen-Image");
  });

  it("can select Qwen Image 2.0 Pro and keeps it after a reload", async () => {
    let serverPayload = payload;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/admin/images") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.model).toBe("Qwen/Qwen-Image-2.0-Pro");
        serverPayload = {
          ...payload,
          settings: { ...payload.settings, model: "Qwen/Qwen-Image-2.0-Pro" },
        };
      }
      if (String(input).includes("/api/admin/images")) return new Response(JSON.stringify(serverPayload), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const first = render(<AdminImagesPanel />);
    const model = await screen.findByRole("combobox", { name: "Model" });
    fireEvent.change(model, { target: { value: "Qwen/Qwen-Image-2.0-Pro" } });
    expect(model).toHaveValue("Qwen/Qwen-Image-2.0-Pro");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("Qwen/Qwen-Image-2.0-Pro"));

    first.unmount();
    render(<AdminImagesPanel />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("Qwen/Qwen-Image-2.0-Pro"));
  });

  it("sends only the current canonical selection for a connection test", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (String(input).includes("/api/admin/images")) return new Response(JSON.stringify(payload), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    render(<AdminImagesPanel />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Provider" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Test Together AI" }));

    await waitFor(() => expect(requestBodies).toHaveLength(1));
    expect(requestBodies[0]).toEqual({ provider: "together", model: "Qwen/Qwen-Image-2.0", action: "test" });
  });
});

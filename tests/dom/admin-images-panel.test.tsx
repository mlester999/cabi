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

beforeEach(() => {
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
    expect(screen.getByRole("option", { name: /Qwen Image 2\.0 Pro · Premium/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Together AI API Key")).toHaveAttribute("type", "password");
    expect(screen.queryByLabelText(/Base URL/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenAI-compatible/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Model" })).not.toBeInTheDocument();
    expect(screen.getByText(/Reference ready/i)).toBeInTheDocument();
  });

  it("updates the live reference capability preview when the model changes", async () => {
    render(<AdminImagesPanel />);
    const model = await screen.findByRole("combobox", { name: "Model" });
    fireEvent.change(model, { target: { value: "Qwen/Qwen-Image" } });
    expect(screen.getByText("Text only")).toBeInTheDocument();
    expect(screen.getByTestId("cabi-reference-panel")).toHaveAttribute("data-model", "Qwen/Qwen-Image");
  });
});

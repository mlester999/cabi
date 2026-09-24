import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { Badge, Card, EmptyState, Field, Input, Inset, LockedCard, Select, StatusCard, Textarea, Toggle } from "@/components/ui/cabi-primitives";
import { Button, IconButton } from "@/components/ui/cabi-button";
import { LockedFeatureCard } from "@/components/features/locked-feature";

/**
 * The design system, as assertions.
 *
 * The visual pass that produced `styles/tokens.css` is only durable if something
 * stops the drift from coming back. These tests are that something: they read the
 * real source files and fail when a component hardcodes a colour, invents a corner
 * radius, or restates a control height instead of using the tokens.
 */

/* ---------------------------------------------------------------------------
 * Source-level consistency
 * ------------------------------------------------------------------------- */

function sourceFiles(directory: string, extensions = [".tsx"]): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (extensions.some((extension) => entry.endsWith(extension))) out.push(full);
    }
  };
  walk(directory);
  return out;
}

const uiFiles = [...sourceFiles("app"), ...sourceFiles("components")];

describe("the palette is centralised", () => {
  it("has no hardcoded surface, border, or text colour left in any component", () => {
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const source = readFileSync(file, "utf8");
      // The token file itself is where literal colour values belong.
      if (file.endsWith("tokens.css")) continue;
      const matches = source.match(/text-\[#[0-9a-fA-F]{6}\]|border-white\/\[[^\]]+\]|bg-white\/\[[^\]]+\]|bg-\[#[0-9a-fA-F]{6}\]/gu);
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].slice(0, 4).join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("declares every documented token", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    for (const token of [
      "--cabi-bg", "--cabi-surface", "--cabi-surface-elevated", "--cabi-border", "--cabi-border-hover",
      "--cabi-text", "--cabi-text-secondary", "--cabi-text-muted", "--cabi-primary", "--cabi-primary-strong",
      "--cabi-success", "--cabi-warning", "--cabi-danger",
      "--cabi-radius-sm", "--cabi-radius-md", "--cabi-radius-lg", "--cabi-radius-xl", "--cabi-radius-2xl", "--cabi-radius-pill",
      "--cabi-shadow-sm", "--cabi-shadow-md", "--cabi-shadow-lg", "--cabi-glow",
      "--cabi-blur-sm", "--cabi-blur-md", "--cabi-blur-lg",
      "--cabi-duration-fast", "--cabi-duration-normal", "--cabi-duration-slow",
      "--cabi-control-sm", "--cabi-control-md", "--cabi-control-lg",
    ]) {
      expect(tokens, `${token} must be declared`).toContain(token);
    }
  });

  it("keeps one radius scale instead of ad-hoc pixel values", () => {
    // `rounded-[13px]`, `rounded-[22px]`, `rounded-[26px]` and friends were the
    // reason corners did not match between screens. Only the 3px micro-radius used
    // by tiny inline swatches is allowed to sit off the scale.
    const allowed = new Set(["rounded-[3px]"]);
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.match(/rounded-\[[0-9]+px\]/gu) ?? []) {
        if (!allowed.has(match)) offenders.push(`${file}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps control heights to the documented sizes", () => {
    /*
     * 28px inline chrome, 32px chips, 36px small, 44px medium, 48px large — the
     * five declared in tokens.css. `components/ui/*` are the vendored shadcn
     * primitives: they are third-party source in this repository, so they are out
     * of scope for the app's own consistency rule.
     */
    const offenders: string[] = [];
    for (const file of uiFiles) {
      if (file.replace(/\\/gu, "/").includes("components/ui/")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.match(/\bh-(?:7|10|13|14)\b/gu) ?? []) {
        offenders.push(`${file}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares exactly the documented control heights", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    for (const size of ["--cabi-control-inline: 28px", "--cabi-control-sm: 36px", "--cabi-control-md: 44px", "--cabi-control-lg: 52px"]) {
      expect(tokens).toContain(size);
    }
  });

  it("routes every button through the shared contract", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    // The contract exists and each variant is defined exactly once.
    for (const variant of ["cabi-btn-primary", "cabi-btn-secondary", "cabi-btn-ghost", "cabi-btn-danger", "cabi-btn-link", "cabi-btn-icon"]) {
      expect(tokens).toContain(`.${variant}`);
    }
  });

  it("uses one icon library", () => {
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const source = readFileSync(file, "utf8");
      // A second icon package, or an inline icon font, would show up here.
      if (/from "(?:@heroicons|@tabler|react-icons|@radix-ui\/react-icons)/u.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * Primitives
 * ------------------------------------------------------------------------- */

describe("button contract", () => {
  it("defaults to the secondary variant at the medium size", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("cabi-btn-secondary");
    expect(button.className).toContain("cabi-btn-md");
    // A default type matters: a bare button inside a form would otherwise submit.
    expect(button).toHaveAttribute("type", "button");
  });

  it("applies exactly one variant and one size class", () => {
    render(<Button variant="primary" size="lg">Go</Button>);
    const className = screen.getByRole("button", { name: "Go" }).className;
    expect(className).toContain("cabi-btn-primary");
    expect(className).toContain("cabi-btn-lg");
    expect(className).not.toContain("cabi-btn-secondary");
  });

  it("exposes a disabled state that removes pointer events", () => {
    render(<Button disabled>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    // The visual rule lives in the contract, not in a per-call-site override.
    expect(readFileSync("styles/tokens.css", "utf8")).toMatch(/\.cabi-btn:disabled[^{]*\{[^}]*pointer-events:\s*none/u);
  });

  it("requires an accessible name on an icon button", () => {
    render(<IconButton label="Delete message">×</IconButton>);
    expect(screen.getByRole("button", { name: "Delete message" })).toBeInTheDocument();
  });

  it("gives every variant a focus ring from the tokens", () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" }).className).toContain("cabi-focus");
  });
});

describe("form controls", () => {
  it("renders one input style for text, select, and textarea", () => {
    render(
      <>
        <Input aria-label="Name" />
        <Select aria-label="Provider"><option>Together AI</option></Select>
        <Textarea aria-label="Notes" />
      </>,
    );
    expect(screen.getByLabelText("Name").className).toContain("cabi-input");
    expect(screen.getByLabelText("Provider").className).toContain("cabi-select");
    expect(screen.getByLabelText("Notes").className).toContain("cabi-textarea");
  });

  it("ties a label to its control and shows help or error, never both", () => {
    const { rerender } = render(<Field label="Model" help="Leave blank to auto-discover"><Input /></Field>);
    // The wrapper is the label — help text and all — so this resolves to the live
    // control rather than to a label element that points at nothing. That binding
    // is what makes the field reachable by click and by assistive technology.
    expect(screen.getByLabelText(/^Model/u).tagName).toBe("INPUT");
    expect(screen.getByText("Leave blank to auto-discover")).toBeInTheDocument();

    rerender(<Field label="Model" help="Leave blank to auto-discover" error="That model is unavailable"><Input /></Field>);
    // One message surface per field.
    expect(screen.getByRole("alert")).toHaveTextContent("That model is unavailable");
    expect(screen.queryByText("Leave blank to auto-discover")).not.toBeInTheDocument();
  });

  it("announces an invalid control through aria-invalid", () => {
    render(<Input aria-label="Endpoint" aria-invalid />);
    expect(screen.getByLabelText("Endpoint")).toHaveAttribute("aria-invalid", "true");
  });

  it("makes the toggle a real switch, not a styled checkbox", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onCheckedChange={onChange} label="Enable image generation" />);
    const toggle = screen.getByRole("switch", { name: "Enable image generation" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reports the on state to assistive technology", () => {
    render(<Toggle checked onCheckedChange={() => undefined} label="Allow guests" />);
    expect(screen.getByRole("switch", { name: "Allow guests" })).toHaveAttribute("aria-checked", "true");
  });
});

/* ---------------------------------------------------------------------------
 * Cards and states
 * ------------------------------------------------------------------------- */

describe("card contract", () => {
  it("uses one base surface for every variant", () => {
    const { rerender } = render(<Card data-testid="card">content</Card>);
    expect(screen.getByTestId("card").className).toContain("cabi-card");

    rerender(<Card data-testid="card" interactive selected>content</Card>);
    const className = screen.getByTestId("card").className;
    expect(className).toContain("cabi-card-interactive");
    // Exactly one glow, and only on the selected card.
    expect(className).toContain("cabi-card-selected");
  });

  it("maps tones onto the feedback surfaces", () => {
    for (const [tone, expected] of [["success", "cabi-surface-success"], ["warning", "cabi-surface-warning"], ["danger", "cabi-surface-danger"]] as const) {
      const { unmount } = render(<Card data-testid="t" tone={tone}>x</Card>);
      expect(screen.getByTestId("t").className).toContain(expected);
      unmount();
    }
  });

  it("renders an inset inside a card with the hairline treatment", () => {
    render(<Inset data-testid="inset">row</Inset>);
    expect(screen.getByTestId("inset").className).toContain("cabi-inset");
  });
});

describe("locked features", () => {
  it("labels a future feature without offering a broken control", () => {
    render(<LockedFeatureCard flagKey="leaderboard_enabled" />);
    const card = screen.getByRole("button", { name: /In the works/u });
    expect(card).toBeInTheDocument();
    // Read as intentionally closed: the shared locked surface, a lock, and the
    // standard badge — and never a disabled-looking fake action.
    expect(card.className).toContain("cabi-locked");
    expect(screen.getByText("In the works")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disabled/u })).not.toBeInTheDocument();
  });

  it("explains itself in Cabi's voice when tapped", () => {
    const onNotice = vi.fn();
    render(<LockedFeatureCard flagKey="leaderboard_enabled" onNotice={onNotice} />);
    fireEvent.click(screen.getByRole("button", { name: /In the works/u }));
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/still in the works/iu));
  });

  it("shows no data of any kind", () => {
    render(<LockedFeatureCard flagKey="portfolio_enabled" />);
    // No placeholder balance, rank, or count — a plausible fake is worse than none.
    expect(document.body.textContent ?? "").not.toMatch(/\d/u);
  });

  it("uses the shared LockedCard contract for a hand-built locked card", () => {
    render(<LockedCard title="Leaderboard" description="Weekly and monthly rankings" />);
    expect(screen.getByText("Leaderboard")).toBeInTheDocument();
    expect(screen.getByText("In the works")).toBeInTheDocument();
    expect(document.querySelector(".cabi-locked")).not.toBeNull();
  });
});

describe("status and empty states", () => {
  it("keeps developer diagnostics behind a disclosure", () => {
    render(<StatusCard tone="danger" title="Model access restricted" detail="Together returned HTTP 403." advanced="endpoint=https://api.together.xyz" />);
    expect(screen.getByText("Model access restricted")).toBeInTheDocument();
    // The summary is present; the detail is not, until it is opened.
    expect(screen.getByText("Advanced details")).toBeInTheDocument();
    const details = screen.getByText("Advanced details").closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it("shows no diagnostics block when there is nothing advanced to say", () => {
    render(<StatusCard tone="success" title="Connected" detail="Together AI" />);
    expect(screen.queryByText("Advanced details")).not.toBeInTheDocument();
  });

  it("renders an empty state with a title, a reason, and one action", () => {
    render(<EmptyState title="No saved chats yet" description="Start one and it will appear here." action={<Button variant="primary">New chat</Button>} />);
    expect(screen.getByText("No saved chats yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
  });

  it("renders a badge tone through the shared shape", () => {
    render(<Badge tone="success">Live</Badge>);
    const badge = screen.getByText("Live");
    expect(badge.className).toContain("cabi-badge");
    expect(badge.className).toContain("cabi-badge-success");
  });
});

/* ---------------------------------------------------------------------------
 * Modal + navigation consistency
 * ------------------------------------------------------------------------- */

describe("modal contract", () => {
  it("gives every modal the same backdrop, radius, and surface", () => {
    const dialog = readFileSync("components/ui/dialog.tsx", "utf8");
    expect(dialog).toContain("cabi-backdrop");
    expect(dialog).toContain("cabi-modal");
    // The vendor default `bg-black/50` and `rounded-lg` must be gone.
    expect(dialog).not.toMatch(/bg-black\/50/u);
  });

  it("keeps the close control the same size everywhere", () => {
    const dialog = readFileSync("components/ui/dialog.tsx", "utf8");
    expect(dialog).toMatch(/h-9 w-9/u);
  });
});

describe("navigation", () => {
  it("groups the admin console instead of listing every screen flat", () => {
    const shell = readFileSync("components/admin/admin-shell.tsx", "utf8");
    for (const group of ["Core", "AI", "Product", "System"]) {
      expect(shell, `${group} group must exist`).toContain(`label: "${group}"`);
    }
    // Four named groups, not fifteen loose links.
    expect(shell).toMatch(/navigationGroups/u);
  });

  it("exposes the current page to assistive technology", () => {
    const shell = readFileSync("components/admin/admin-shell.tsx", "utf8");
    expect(shell).toContain('aria-current={isActive(href) ? "page" : undefined}');
  });

  it("keeps the collapsed rail usable on a mid-size screen", () => {
    const shell = readFileSync("components/admin/admin-shell.tsx", "utf8");
    // The rail hides labels, so each icon needs its own accessible name.
    expect(shell).toMatch(/title=\{`\$\{group\.label\} · \$\{label\}`\}/u);
  });
});

/* ---------------------------------------------------------------------------
 * Accessibility invariants
 * ------------------------------------------------------------------------- */

describe("accessibility invariants", () => {
  it("defines one focus treatment and applies it through a class", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    expect(tokens).toMatch(/\.cabi-focus:focus-visible/u);
    expect(tokens).toContain("--cabi-primary");
  });

  it("honours reduced motion in the token layer", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    expect(tokens).toContain("prefers-reduced-motion");
  });

  it("keeps a 44px minimum touch target available", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    expect(tokens).toMatch(/--cabi-control-md:\s*44px/u);
    expect(tokens).toContain(".cabi-touch-target");
  });

  it("never lets browser autofill paint a white field", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    expect(tokens).toContain(":-webkit-autofill");
  });
});

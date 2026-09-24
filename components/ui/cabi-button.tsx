import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The one Button.
 *
 * Before this existed the app hand-rolled ~340 buttons across 127 components,
 * with six different heights (32/36/40/44/48/56px), a dozen bespoke class strings,
 * and a vendor `Button` that almost nothing used. This wraps the semantic
 * `.cabi-btn-*` classes from `styles/tokens.css`, so a button's size and tone come
 * from the design system rather than from the screen it happens to live on.
 *
 * Accessibility is built in, not bolted on: a 44px minimum touch target at `md`
 * and above, a visible focus ring from the tokens, and a real `disabled` state
 * that removes pointer events rather than only fading the colour.
 */

const buttonVariants = cva("cabi-btn cabi-focus", {
  variants: {
    variant: {
      primary: "cabi-btn-primary",
      secondary: "cabi-btn-secondary",
      ghost: "cabi-btn-ghost",
      danger: "cabi-btn-danger",
      link: "cabi-btn-link",
    },
    size: {
      sm: "cabi-btn-sm",
      md: "cabi-btn-md",
      lg: "cabi-btn-lg",
    },
    block: {
      true: "cabi-btn-block",
      false: "",
    },
  },
  defaultVariants: { variant: "secondary", size: "md", block: false },
});

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Renders the child element instead of a `<button>`, for links. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, block, asChild = false, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, block }), className);
  // `asChild` is intentionally not implemented with Radix Slot: the only caller
  // shape in this app is "a link that looks like a button", and an `<a>` with the
  // same classes is clearer than a polymorphic wrapper.
  if (asChild && React.isValidElement(props.children)) {
    const child = props.children as React.ReactElement<{ className?: string }>;
    return React.cloneElement(child, { className: cn(classes, child.props.className) });
  }
  return <button type="button" className={classes} {...props} />;
}

/**
 * A square icon button. Every icon action in the app uses this, so icon hit areas
 * are the same size everywhere instead of being `h-9 w-9` on one screen and
 * `h-11 w-11` on the next.
 */
export function IconButton({
  className,
  variant = "ghost",
  size = "md",
  label,
  children,
  ...props
}: Omit<ButtonProps, "size" | "block"> & {
  size?: "sm" | "md";
  /** Required: an icon-only control must have an accessible name. */
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "cabi-btn cabi-focus",
        size === "sm" ? "cabi-btn-icon-sm" : "cabi-btn-icon",
        variant === "primary" ? "cabi-btn-primary"
          : variant === "secondary" ? "cabi-btn-secondary"
          : variant === "danger" ? "cabi-btn-danger"
          : "cabi-btn-ghost",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export { buttonVariants };

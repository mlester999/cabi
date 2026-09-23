# Shared UI components

## `components/cabi/mini-cabi.tsx` — MiniCabi

Compact Cabi identity mark used throughout public and admin surfaces.

```tsx
"use client";

import { useState } from "react";

export function MiniCabi({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[14px] border border-violet-300/20 bg-violet-400/10 ${className}`}>
      <span aria-label={decorative ? undefined : "Cabi"} aria-hidden={decorative} className="relative text-[12px] font-black tracking-[-0.08em] text-violet-200 before:absolute before:-left-1 before:-top-2 before:h-2 before:w-2 before:rotate-45 before:rounded-[2px] before:bg-violet-300/65 after:absolute after:-right-1 after:-top-2 after:h-2 after:w-2 after:rotate-45 after:rounded-[2px] after:bg-violet-300/65">CA</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/cabi-mascot.png"
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full object-contain p-1 transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
    </span>
  );
}
```

## `components/ui/button.tsx` — Button

Shared class-variance button primitive.

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({ className, variant = "default", size = "default", asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
```

## `components/ui/popover.tsx` — Popover

Radix-based anchored content surface used for compact account controls.

```tsx
"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) { return <PopoverPrimitive.Root data-slot="popover" {...props} /> }
function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) { return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} /> }
function PopoverContent({ className, align = "center", sideOffset = 4, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return <PopoverPrimitive.Portal><PopoverPrimitive.Content data-slot="popover-content" align={align} sideOffset={sideOffset} className={cn("z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0", className)} {...props} /></PopoverPrimitive.Portal>
}
function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) { return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} /> }
function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="popover-header" className={cn("flex flex-col gap-1 text-sm", className)} {...props} /> }
function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) { return <div data-slot="popover-title" className={cn("font-medium", className)} {...props} /> }
function PopoverDescription({ className, ...props }: React.ComponentProps<"p">) { return <p data-slot="popover-description" className={cn("text-muted-foreground", className)} {...props} /> }

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverTitle, PopoverDescription }
```

## `components/ui/dialog.tsx` — Dialog

Radix-based modal surface. Full source lives at the path above and provides Root, Trigger, Overlay, Content, Header, Footer, Title, Description, and Close exports.

```tsx
"use client"
import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) { return <DialogPrimitive.Root data-slot="dialog" {...props} /> }
function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) { return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} /> }
function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) { return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} /> }
function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) { return <DialogPrimitive.Close data-slot="dialog-close" {...props} /> }
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) { return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn("fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0", className)} {...props} /> }
function DialogContent({ className, children, showCloseButton = true, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return <DialogPortal><DialogOverlay /><DialogPrimitive.Content data-slot="dialog-content" className={cn("fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg", className)} {...props}>{children}{showCloseButton && <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 hover:opacity-100"><XIcon /><span className="sr-only">Close</span></DialogPrimitive.Close>}</DialogPrimitive.Content></DialogPortal>
}
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) { return <div className={cn("flex flex-col gap-2 text-center sm:text-left", className)} {...props} /> }
function DialogFooter({ className, showCloseButton = false, children, ...props }: React.ComponentProps<"div"> & { showCloseButton?: boolean }) { return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props}>{children}{showCloseButton && <DialogPrimitive.Close asChild><Button variant="outline">Close</Button></DialogPrimitive.Close>}</div> }
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title className={cn("text-lg leading-none font-semibold", className)} {...props} /> }
function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} /> }
export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger }
```

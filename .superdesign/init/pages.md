# Page dependency trees

## `/` — Cabi chat

Entry: `app/page.tsx`

- `components/cabi/cabi-experience.tsx`
  - `components/chat/chat-message.tsx`
    - `components/ui/bubble.tsx`
    - `components/ui/message.tsx`
    - `components/ui/tooltip.tsx`
  - `components/cabi/mini-cabi.tsx`
  - `lib/client/sse.ts`
- `app/layout.tsx`
  - `app/globals.css`

## `/settings`

Entry: `app/settings/page.tsx`

- `components/settings/settings-experience.tsx`
  - `components/cabi/mini-cabi.tsx`
  - `components/ui/switch.tsx`
  - `components/ui/tabs.tsx`
- `app/layout.tsx`
  - `app/globals.css`

## `/admin/cpu`

Entry: `app/admin/(console)/cpu/page.tsx`

- `components/admin/config-panel.tsx`
- `app/admin/(console)/layout.tsx`
  - `components/admin/admin-shell.tsx`
    - `components/cabi/mini-cabi.tsx`
  - `lib/security/session.ts`
- `app/layout.tsx`
  - `app/globals.css`

## `/admin`

Entry: `app/admin/(console)/page.tsx`

- `components/admin/admin-dashboard.tsx`
- `app/admin/(console)/layout.tsx`
  - `components/admin/admin-shell.tsx`
    - `components/cabi/mini-cabi.tsx`
  - `lib/security/session.ts`
- `app/layout.tsx`
  - `app/globals.css`


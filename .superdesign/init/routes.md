# Route map

Framework: Next.js 16 App Router through vinext/Vite.

| URL | Entry | Layout / summary |
| --- | --- | --- |
| `/` | `app/page.tsx` | Root layout; renders `CabiExperience` chat shell. |
| `/settings` | `app/settings/page.tsx` | Root layout; renders persistent preference/memory settings. |
| `/admin/login` | `app/admin/login/page.tsx` | Root layout; protected-console sign-in. |
| `/admin` | `app/admin/(console)/page.tsx` | `app/admin/(console)/layout.tsx` + `AdminShell`. |
| `/admin/ai` | `app/admin/(console)/ai/page.tsx` | AI provider settings. |
| `/admin/personality` | `app/admin/(console)/personality/page.tsx` | Cabi personality configuration. |
| `/admin/knowledge` | `app/admin/(console)/knowledge/page.tsx` | Knowledge crawler/index controls. |
| `/admin/cpu` | `app/admin/(console)/cpu/page.tsx` | CPU token configuration. |
| `/admin/branding` | `app/admin/(console)/branding/page.tsx` | Branding configuration. |
| `/admin/users` | `app/admin/(console)/users/page.tsx` | User listing. |
| `/admin/conversations` | `app/admin/(console)/conversations/page.tsx` | Conversation listing. |
| `/admin/memories` | `app/admin/(console)/memories/page.tsx` | Memory listing. |
| `/admin/settings` | `app/admin/(console)/settings/page.tsx` | Application settings. |
| `/admin/audit` | `app/admin/(console)/audit/page.tsx` | Security/audit log. |

`/cpu` is the requested new public token-information route and does not exist in the baseline.


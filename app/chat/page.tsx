import { redirect } from "next/navigation";

/**
 * Legacy chat path.
 *
 * Cabi's chat *is* the home route, so `/chat` always redirects to `/`. While
 * the site is in PRELAUNCH that lands on the prelaunch page; once LIVE it opens
 * the application. No unfinished surface is ever rendered at this path.
 */
export default function ChatPage() {
  redirect("/");
}

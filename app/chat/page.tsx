import { redirect } from "next/navigation";

/**
 * Legacy chat path.
 *
 * Cabi's chat *is* the home route, so `/chat` always redirects to `/`. While
 * the site is in PRELAUNCH that lands on the prelaunch page; once LIVE the home
 * route applies the $CPU holder gate before any application code is sent. There
 * is deliberately no way to reach the application itself from this path.
 */
export default function ChatPage() {
  redirect("/");
}

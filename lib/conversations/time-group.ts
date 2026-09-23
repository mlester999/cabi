export type ConversationTimeGroup = "Today" | "Yesterday" | "Previous 7 Days" | "Older";

function localDayNumber(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return Math.floor(Date.UTC(read("year"), read("month") - 1, read("day")) / 86_400_000);
}

export function validTimeZone(value: string | null | undefined) {
  if (!value || value.length > 80) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

export function conversationTimeGroup(
  timestamp: string | Date,
  now: Date = new Date(),
  timeZone = "UTC",
): ConversationTimeGroup {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Older";
  const zone = validTimeZone(timeZone);
  const daysAgo = localDayNumber(now, zone) - localDayNumber(date, zone);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= 7) return "Previous 7 Days";
  return "Older";
}

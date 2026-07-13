export function greetingForTime(date: Date, name: string): string {
  const hour = date.getHours();
  const daypart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${daypart}, ${name}`;
}

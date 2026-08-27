export function isUrgentOptionsAction(action: string): boolean {
  return /^open urgent options[.!]?$/i.test(action.trim());
}

export function revealUrgentOptions(details: HTMLDetailsElement | null): boolean {
  if (!details) return false;
  details.open = true;
  details.scrollIntoView({ block: "nearest" });
  details.querySelector<HTMLElement>("summary")?.focus();
  return true;
}

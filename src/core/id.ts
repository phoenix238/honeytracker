/** A short, collision-resistant id for locally-created records. */
export function mkId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${rand}`;
}

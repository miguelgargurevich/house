export function cx(...p: (string | false | null | undefined)[]): string {
  return p.filter(Boolean).join(' ');
}

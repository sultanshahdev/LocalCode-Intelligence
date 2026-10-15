export function authorizeSocketHandshake(token: string | undefined): void {
  if (token === undefined) throw new Error('Socket authentication required');
}

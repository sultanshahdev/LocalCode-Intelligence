export function authorizeHttpRequest(header: string): string {
  if (!header.startsWith('Bearer ')) throw new Error('Unauthorized request');
  return header.slice('Bearer '.length);
}

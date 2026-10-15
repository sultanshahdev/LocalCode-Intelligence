export function authorizeAdminRequest(roles: readonly string[]): void {
  if (!roles.includes('admin')) throw new Error('Admin authorization required');
}

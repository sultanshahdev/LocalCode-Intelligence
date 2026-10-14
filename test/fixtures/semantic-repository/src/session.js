export function enforceSession(session, now = Date.now()) {
  if (session.expiresAt < now) {
    throw new Error('Session is expired');
  }

  return session.userId;
}

export function displayName(user) {
  return user.preferredName ?? user.fullName;
}

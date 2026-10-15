# Ranked candidate labels

For the query “where is an incoming request authorized?”, this fixture contains
three plausible implementation locations:

1. `src/http-authorization.ts` validates a bearer token before an HTTP handler runs.
2. `src/admin-authorization.ts` rejects authenticated users without the admin role.
3. `src/socket-authorization.ts` authenticates a token during a socket handshake.

All three are candidate authorization implementations, but their ordering is only
the controlled semantic ranking used by the acceptance test. It is not proof that
the first candidate is the correct implementation for an unspecified caller.

`src/date-format.ts` is an unrelated distractor and must be withheld by the existing
positive-alignment display policy in the deterministic acceptance test.

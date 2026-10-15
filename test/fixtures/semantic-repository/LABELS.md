# Retrieval labels

For the query “where is an expired session rejected?”, the labeled evidence is
`src/session.js`, lines 1–7. The other files are unrelated distractors.

For queries about unrelated domains such as spacecraft telemetry, this fixture has
no labeled relevant implementation. Any returned region must be treated as uncertain
rather than evidence that the requested behavior exists.

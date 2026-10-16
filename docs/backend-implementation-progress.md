# Backend implementation progress

- Branch: `feat/multilingual-backend-v1`
- Starting commit: `24283e4`
- Latest implementation commit: pending shared-snapshot checkpoint.
- Current implemented, verified slice: secure repository-map manifest endpoint and UI hierarchy explorer.
- Passing verification: `npm run build`, `npm test` (92 passing, 2 explicitly skipped model/deferred tests).
- Parser runtime: `web-tree-sitter@0.27.1` with offline packaged grammar assets from `tree-sitter-wasm@2.0.4`.
- Implemented structural languages: JS/TS (TypeScript Compiler API), Python, Go, Java, Rust, C, C++, C#, Ruby, PHP, and Bash (Tree-sitter WASM).
- C/C++ header policy: `.h` belongs deterministically to C; C++ owns `.hpp`, `.hh`, and `.hxx`.
- Verified WASM proof: Python, Rust, and C# grammars load and parse under Node 24 without network access after installation.
- Shared snapshot: one deterministic, no-follow bounded source read is now used by production WASM symbol and usage analysis. The legacy JS/TS TypeScript checker remains separately bounded to preserve its established compiler semantics.

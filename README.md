# LocalCode Intelligence

LocalCode Intelligence currently provides one local-only command for validating
the directory that will be the scope of a future investigation. It does not
search, scan, or index source code.

## Requirements

- Node.js 20 or newer
- npm

## Install

```sh
npm install
npm run build
npm link
```

`npm link` makes the `localcode` executable available from your shell. During
development, you can run the same command without linking via `npm run localcode --`.

## Check a repository scope

```sh
localcode repo check ./path/to/source
```

Or, without `npm link`:

```sh
npm run localcode -- repo check ./path/to/source
```

On success, LocalCode reports the resolved absolute directory:

```text
Validated repository scope: /absolute/path/to/source
Status: directory is readable; indexing has not been performed.
```

The path may be relative or absolute and may contain spaces. It must exist, be
a directory, and permit read-only access (including directory traversal where
the operating system requires it). Git metadata is not required.

Exit statuses are `0` for successful validation, `1` when the path cannot be
used, and `2` for command or argument usage errors. Errors are written to
standard error.

## Tests

```sh
npm test
```

Tests create isolated fixtures in the operating system's temporary directory;
they do not modify the repository being checked.

## Current limitations

- Validation is not persisted between CLI invocations.
- The command validates only the exact supplied directory. It does not inspect
  nested repositories or read source-file contents.
- Successful validation means only that the directory exists and is readable.
  It does not mean the directory was indexed or is ready for search.
- Access-denied behavior is tested with deterministic filesystem substitutes,
  because permission-bit integration tests are unreliable when tests run with
  elevated privileges or on platforms with different permission models.

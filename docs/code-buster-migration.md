# Code Buster repository naming and deployment notes

The product is branded **Code Buster**. The owner authorized renaming the GitHub repository from `sultanshahdev/LocalCode-Intelligence` to `sultanshahdev/code-buster`.

## Remote rename status

The README and landing-page GitHub links have been prepared for `sultanshahdev/code-buster`. **The actual GitHub repository rename must be performed in the repository's GitHub Settings**; editing source files does not rename a remote repository.

1. Open **GitHub → Repository → Settings → General → Repository name**.
2. Change `LocalCode-Intelligence` to `code-buster`.
3. Save the rename. Confirm the new URL loads before announcing it.
4. Update the GitHub repository description and topics to match the product.
5. Update each local checkout's `origin`:
   ```bash
   git remote set-url origin https://github.com/sultanshahdev/code-buster.git
   git remote -v
   ```
6. Revisit GitHub integrations and links relying on the old repository location. GitHub redirects many old repository URLs, but existing Git remotes and integrations should still be updated explicitly.
7. Connect the **renamed** repository to Cloudflare Pages if deploying the static website.

Recommended repository description:

> Find the code behind the behavior. Local-first semantic code search, multilingual repository exploration, and source-grounded code navigation.

Suggested topics: `code-search`, `semantic-search`, `developer-tools`, `typescript`, `tree-sitter`, `code-navigation`, `local-first`.

## Compatibility

- `codebuster` is the preferred CLI command.
- `localcode` remains a compatibility alias.
- Existing environment/cache names (for example, `LOCALCODE_EMBEDDING_CACHE_DIR`) intentionally remain compatible so existing local data is not silently abandoned.
- Renaming the GitHub repository is independent of the npm package name and CLI command.

## Cloudflare Pages scope

The static Vite website can be deployed from the `web` folder with:

- Production branch: `main`
- Root directory: `web`
- Build command: `npm run build`
- Output directory: `dist`

**The current Node API is localhost-only.** A Cloudflare Pages static deployment serves the site and illustrative demonstrations but **does not run the live repository-analysis workspace**. A browser-native engine or a separately secured production API must be implemented before describing the public website as a functioning hosted code-search service.

Do not expose `src/server.ts` directly by changing its listen address. It accepts local filesystem operations and is designed for a trusted single-user local environment.

## Brand/name diligence

Before a broad public product launch, check the Code Buster name against existing developer-product branding and trademarks. A repository rename is not itself trademark clearance.

# Code Buster naming and repository migration notes

The product is branded **Code Buster**. The public GitHub repository intentionally remains
`sultanshahdev/LocalCode-Intelligence` until an owner explicitly authorizes a remote rename.

`codebuster` is the preferred CLI command. `localcode` remains a compatibility alias. Existing
cache/environment names are intentionally retained for this release so no local cache is orphaned.

Before a public launch, perform trademark and market clearance. A preliminary search identified
another developer-oriented product using “Code Buster” (associated with Tool Bunker); this document
does not claim the name is legally clear. The npm registry name `code-buster` returned available at
the time of this change, which is not a trademark assessment.

## Future remote repository rename checklist

1. Confirm legal/name clearance and authorize the remote rename.
2. Rename the GitHub repository and update local `origin` URLs.
3. Update README, package, issue, and social links.
4. Review Vite `base` and GitHub Pages URLs if static hosting is later added.
5. Keep the Node API deployment separate: the current app requires a localhost Node server for
   local folders and `/api` routes; a static frontend alone cannot provide those capabilities.

# Releasing `opencode-dtoc`

This document is for maintainers publishing the plugin officially.

## Before publishing

1. Make the change on a branch.
2. Update `CHANGELOG.md` and the version in `package.json`.
3. Run the checks:

   ```sh
   bun install
   bun test
   bun run build
   npm pack --dry-run
   ```

4. Inspect the dry-run package and confirm it contains the README, license, changelog, and current `dist` files.
5. Test the package from a clean OpenCode installation if the change affects runtime behavior.

## Preview release

Use the `next` tag first so existing users on `latest` are not affected:

```sh
npm whoami
npm publish --tag next
npm view opencode-dtoc dist-tags --json
npm view opencode-dtoc@0.2.1 version
```

Install the preview with:

```sh
npm install opencode-dtoc@next
```

Then configure OpenCode with `"opencode-dtoc@next"` and test enable, disable, and replace behavior.

## Promote to stable

After the preview is validated, move the exact published version to `latest`:

```sh
npm dist-tag add opencode-dtoc@0.2.1 latest
npm view opencode-dtoc dist-tags --json
```

Users can then configure `"opencode-dtoc"` without a tag.

## Authentication

npm may open a browser for authentication or require an account security key. Do not use a plain password in scripts. Confirm authentication with:

```sh
npm whoami
```

If npm reports that two-factor authentication or a granular access token is required, complete the account's npm security setup and retry the publish command.

## Corrections and rollback

An npm version that has been published cannot be overwritten. Publish a new patch version instead, for example `0.2.1`, and move the tag only after validation. Avoid deleting or unpublishing a release as a normal rollback strategy.

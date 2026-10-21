# Release and directory submission

This repository prepares an installable plugin. A passing local check is not approval by Obsidian. Publishing a GitHub release and submitting to the Community directory are separate maintainer actions.

## Prepare a version

1. Set the same numeric `x.y.z` version in `manifest.json` and `package.json`. Run `npm install --package-lock-only --ignore-scripts` to update `package-lock.json`. Add its minimum supported Obsidian version to `versions.json`.
2. Keep the manifest description short, in English and ending with a period. Retain `pikoboard` as the plugin ID.
3. Update the user guide and `docs/release-notes.md` for the delivered behavior. Do not include private vault details or internal development logs.
4. Run the checks below, inspect the diff and commit source plus regenerated runtime files.

```sh
npm test
npm run check
npm run release:check
npm run release:pack
```

The output is `dist/pikoboard/` with `main.js`, `manifest.json`, `styles.css`, two license files and `SHA256SUMS`. Only these allowlisted assets are copied. No vault notes, plugin state or test fixtures are packaged. The three runtime assets include the required license notices.

The manifest requires Obsidian 1.14.4 because that is the version used for host checks. Do not lower the minimum without testing the lower version. The code has no Node.js or Electron runtime dependency; mobile support is not yet verified in practice.

## Manual checks before publishing

Use a disposable vault containing synthetic data and no other community plugins. Install only the packaged runtime files. Record the host version, OS and theme in the release review.

- Create and reopen a named board. Add, rename, reorder and remove a column. Confirm task handling when removing a non-empty column.
- Create tasks with optional properties empty and populated. Test tags, filters, saved views and switching boards.
- Edit a formatted description, check a checklist, attach a local file and link a note. Close and reopen the task; confirm saved content.
- Add, edit, copy, delete and restore a journal entry. Edit a next step and expand/collapse its card without losing a draft.
- Move cards between and within columns. Undo the move and a property change. Make an external conflicting edit and confirm undo does not overwrite it.
- Archive and restore a task. Test automatic archiving in a fixture with an expired completion date. Verify deletion follows the Obsidian preference.
- Save and use a template. Confirm history and completed checkboxes are not copied.
- Check System in both default light and dark themes, both PikoBoard palettes, a narrow pane and a pop-out window. Check keyboard focus and menu dismissal.
- Disable and re-enable the plugin. Check for errors, duplicate listeners and lost drafts. Existing board and task data must survive an update.
- Test on the platforms you intend to advertise. Do not describe mobile or a community theme as verified without checking it.

## GitHub release

Push the reviewed commit to GitHub. Create and push a tag exactly matching `manifest.json`, with no `v` prefix.

In **Actions → Draft release**, run the workflow with that version. It validates the tag, tests the code, creates GitHub artifact attestations and attaches only `main.js`, `manifest.json` and `styles.css` to a **draft** GitHub release. The local license and checksum files stay in the local package; license notices are also embedded in `main.js`. It will fail if that release already exists; review the existing draft instead of overwriting it.

Inspect the draft's notes and download its assets for one final clean-vault check. Publish it when ready. A draft is not available to Obsidian's public installer.

The GitHub check workflow also runs on pushes and pull requests. GitLab runs the same checks for the mirror. Neither workflow submits the plugin to the directory.

## Submit to Obsidian

Follow the [official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) and [plugin requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins).

1. Ensure the public GitHub repository's default branch contains the reviewed README, license and matching manifest, and that the matching release is published with `main.js`, `manifest.json` and `styles.css` attached.
2. Sign in to the [Obsidian Community directory](https://community.obsidian.md), link the owning GitHub account and create a plugin submission with the repository URL.
3. Review the [developer policies](https://docs.obsidian.md/community-directory/developer-policies) and support commitments yourself before accepting them.
4. Address review feedback, publish a corrected version when needed, and wait for approval before claiming the plugin is listed.

After acceptance, update the README installation section to include the Community plugins route. Obsidian then uses published GitHub release assets for normal plugin updates. Keep the public source and release contents in sync.

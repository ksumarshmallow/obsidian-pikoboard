# Community directory submission

Prepared for PikoBoard 0.12.1. This document is submission material, not a statement that the plugin has been accepted or listed.

## Listing details

| Field | Value |
| --- | --- |
| Repository | https://github.com/ksumarshmallow/obsidian-pikoboard |
| Plugin ID | `pikoboard` |
| Name | PikoBoard |
| Author | ksumarshmallow |
| Version | `0.12.1` |
| Minimum Obsidian version | `1.14.4` |
| License | MIT |

Description, matching the manifest:

> Plan tasks on customizable boards with projects, due dates, checklists and a journal in each task note.

## Reviewer notes

PikoBoard organizes tasks on customizable boards. Boards are stored as `.pikoboard` files; tasks are ordinary Markdown notes with properties, descriptions, next steps and journal entries. Preferences, drafts and recoverable deleted journal entries are stored locally in the plugin's `data.json`.

The plugin has no telemetry, account requirement, paid service, background network requests or self-updater. External links and embedded resources are rendered by Obsidian and may access the network. Attachments are copied from files explicitly selected by the user. Task deletion asks for confirmation and uses Obsidian's configured deletion behavior.

The formatted description editor uses an internal Obsidian API, with a plain Markdown fallback. Its adapter uses an MIT-licensed technique credited in `THIRD-PARTY-LICENSES.txt`; the attribution is included in the distributed JavaScript. This internal API is a compatibility limitation, documented in the README.

Desktop interaction checks were performed on macOS with Obsidian 1.14.4. Mobile compatibility has not been verified. The manifest permits mobile loading because there are no Node.js or Electron runtime dependencies; it does not imply mobile testing.

## Review materials

- [README and demo screenshot](../README.md)
- [User guide](usage.md)
- [Source and build instructions](development.md)
- [Release notes](release-notes.md)
- [License](../LICENSE) and [third-party notices](../THIRD-PARTY-LICENSES.txt)
- [Release checks and manual validation checklist](releasing.md)

The local validation suite has 249 passing tests and 65 JavaScript syntax checks. Release validation checks version consistency and packaging requirements. The public release contains `main.js`, `manifest.json` and `styles.css`, with license notices embedded in the JavaScript and GitHub attestations for the runtime assets. The local package also includes separate license notices and `SHA256SUMS`. Neither package includes vault notes or plugin state. Automated tests are not a substitute for Obsidian's review.

## Submission handoff

1. The [0.12.1 release](https://github.com/ksumarshmallow/obsidian-pikoboard/releases/tag/0.12.1) is published with `main.js`, `manifest.json` and `styles.css` attached.
2. Sign in to the [Obsidian Community directory](https://community.obsidian.md) with an Obsidian account and connect the owning GitHub account.
3. Add a plugin using the repository URL above. The directory reads the manifest from the default branch.
4. Review the developer policies and any account permissions before accepting and submitting. Use the reviewer notes above where the form allows additional context.
5. Address review feedback with a corrected release. Update the installation instructions only after directory acceptance.

Follow the current [official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) and [developer policies](https://docs.obsidian.md/community-directory/developer-policies).

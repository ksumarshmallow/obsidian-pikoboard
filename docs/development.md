# Development

Use Node.js 18 or newer; CI runs Node.js 22. There are no npm build or test dependencies, so `npm install` is unnecessary.

```sh
git clone https://github.com/ksumarshmallow/obsidian-pikoboard.git
cd obsidian-pikoboard
npm test
npm run check
npm run release:check
```

## Layout

| Path | Responsibility |
| --- | --- |
| `src/plugin.js` | Lifecycle, commands and integration with Obsidian |
| `src/domain/` | Pure task, Markdown, filter, icon and ordering logic |
| `src/storage/` | Vault persistence, board definitions, templates and conflict checks |
| `src/features/boards/` | Board views, column controls, filters and board creation |
| `src/features/tasks/` | Task editor, properties, templates and undo |
| `src/features/journal/` | Shared draft, next step and journal composer |
| `src/ui/` | Reusable controls, menus, dialogs, appearance and editor adapter |
| `src/settings/` | Plugin settings |
| `src/styles/pikoboard.css` | Source styles |
| `scripts/` | Build, syntax and release checks |
| `tests/` | Domain, storage, UI and integration tests |

The domain layer has no Obsidian or DOM dependency. Storage receives Vault and YAML APIs through its constructor. UI utilities do not import features or the plugin entry point. Features receive the plugin instance; they do not import it back.

## Build and install locally

```sh
npm run build
```

The build bundles static CommonJS imports into `main.js` and copies source CSS into `styles.css`. Only `obsidian` and `@codemirror/view` remain external; Obsidian provides them. The bundle is readable, with no runtime `eval` or dynamic code downloads. License notices are included in the JavaScript because directory installations download only runtime assets.

Generated `main.js` and `styles.css` are committed so a Git clone is directly installable. Edit `src/`, rebuild, and include generated changes in the same commit. Release checks compare the files against a fresh in-memory build.

Use a separate test vault. Copy the five files produced by `npm run release:pack` from `dist/pikoboard/` to that vault's plugin folder. Disable PikoBoard before replacement and enable it afterward. Never copy the source checkout over a live plugin's `data.json`.

## Persistence and lifecycle

Task updates run inside `Vault.process` with Obsidian's YAML codec. The atomic callback checks the current document and changes only the intended properties or body section. This allows conflict-sensitive undo and journal writes to preserve independent edits in the same file. Unknown properties are retained; YAML formatting may be normalized.

`TaskActions` serializes property changes, moves and undo. Its one-entry in-memory receipt contains changed fields and card positions. Undo checks expected values inside a new atomic write. New text and unrelated properties survive; a conflicting edit is rejected. Board settings and file deletion do not enter this stack.

`JournalModel` owns the draft shared by the board and modal. Pending writes are flushed before closing editors or deleting tasks. File deletion uses `FileManager.trashFile`, respecting the vault preference. Metadata and vault listeners use `registerEvent`; the archive timer uses `registerInterval`.

The rich description editor is the one deliberate private-API dependency. `src/ui/rich-editor.js` obtains the embedded Markdown editor constructor, checks its shape and caches it per app. Temporary widgets and editor instances are disposed on failure and close. `task-modal.js` retains a textarea until the formatted editor is mounted successfully. Recheck this adapter on every supported Obsidian version; API compatibility is not guaranteed by the public plugin API.

## Styling and input

Use the `--pb-*` tokens and keep styles scoped to PikoBoard. `System` inherits Obsidian variables. Fixed palette values belong in the two PikoBoard presets, not individual components. Preset markers are applied to open Obsidian windows and removed on unload.

Do not recreate an active editor to change appearance. Keep text selection, focus and drafts intact. Use labeled buttons for icon actions, keyboard navigation in menus and visible focus states. Do not add default global hotkeys that conflict with Obsidian.

## Tests and review

- `npm test` builds and runs Node's test runner against the actual modules with mock host APIs.
- `npm run check` checks JavaScript syntax in source, tests, scripts and the generated bundle.
- `npm run release:check` validates metadata, required files, licenses and reproducible assets.
- `npm run release:pack` creates an allowlisted distribution with checksums. It performs no upload.

Automated fixtures cover storage, conflicting writes, drafts, menus, task movement, templates, undo, startup and release packaging. They do not simulate the whole Obsidian renderer. Use the manual matrix in [Releasing](releasing.md) for host behavior and visual changes.

Keep real notes, vault configuration, backups and plugin state out of source control. Screenshots must use synthetic tasks. For a pull request, explain the user-visible change and how you checked it; include a screenshot when the interface changed.

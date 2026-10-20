# Using PikoBoard

PikoBoard uses English for its controls, settings and commands. Your note content and custom names stay as you write them.

## Create a board

Open **Settings → PikoBoard → Create board**, or run **PikoBoard: Create board** from the command palette. Choose a name and a vault folder. The board is a `.pikoboard` file you can reopen from the file explorer.

New boards start with **backlog**, **in progress** and **done**. The plus button to the right adds a column. Drag column headers to reorder them. The board settings menu lets you rename or remove columns and choose their color, intensity and icon. Icon choices come from Obsidian's built-in library; emoji and no icon are also supported.

Deleting a board file does not delete its task notes. They remain accessible from the all-tasks overview and can be moved to another board.

## Add a task

Select **+ Task**. Type a title and press **Enter**. The new task appears at the top of the column. **Cmd/Ctrl+Enter** creates it and opens its editor; **Escape** closes the input. A selected project is inherited by the new task.

Select the task title to open its editor. The property rows are **Status**, **Project**, **Due date** and **Tags**. Only the title and status are required. A task belongs to one board and can have one project.

Type a tag such as `#reading` and press **Enter**. It becomes a chip; continue typing to add another. The chip's cross removes that tag. You can paste several tags separated by spaces. Clicking away also saves pending tag input.

## Write and attach materials

Click the description to edit. Formatting, checklists and links are handled by the embedded Obsidian editor. It saves as you work and when focus moves away. If the embedded editor cannot load, a text field lets you edit the same Markdown content.

The description's **Checklist** and **Materials** controls appear while editing. Materials can link an existing note, create a research note or copy a selected file into the vault. The journal composer also has an attachment control.

## Next step and journal

On the board, the card arrow expands the next step, journal and composer together. A collapsed card keeps just its title and property chips.

| Control | What it does |
| --- | --- |
| **Entry** | Adds a journal entry. Enter sends; Shift+Enter inserts a line break. |
| **Next step** | Replaces the task's pinned next step. It can be text or a checklist. |
| Pencil on the next step | Loads the existing text for editing. |
| Cross on the next step | Clears it, with an undo option. |
| Entry menu `⋯` | Copies, edits or deletes that entry. Deletion asks for confirmation. |

For a next-step checklist, Enter continues the list; Enter on an empty item ends it. **Cmd/Ctrl+Enter** saves the step. Checking an item does not complete the task or automatically write a journal entry. You decide what to record.

Journal entries appear newest first, grouped by date. Deleted entries can be restored immediately or through **PikoBoard: Restore deleted entry**. Drafts are shared between the expanded card and task editor.

## Find work across boards

Use projects, the **Tags** filter and search together. All selected tags must match. Search looks through the task title, project, tags, description, next step and journal. It does not index linked files. Matching is case-insensitive; all entered words must be present.

**Status** selects which columns remain visible. The multiselect stays open until you click outside or press Escape. At least one column stays visible. Hidden columns and their tasks are not deleted.

**Saved filters** saves filters and visible columns for reuse. **In progress** shows active tasks independently of those filters. The all-tasks overview keeps the column layout while bringing work from different boards together.

Due-date chips use a muted rose accent for overdue work and amber for today and the next three days. Completed and archived tasks remain neutral. Dates use your local timezone and refresh while Obsidian is open.

## Templates

Open a task's `⋯` menu and choose **Save as template**. The template copies its description, next step and tags. Checklist items reset; title, project, due date, status and journal history are excluded. Linked files are not duplicated.

Choose **Template** in the new-task input to use a template. Templates are read again on each creation. Editing one does not change existing tasks. You can also create a blank template under **Settings → PikoBoard → Task templates → New template**.

Keep the `pikoboard-template: true` property in a template note. Prefer vault links such as `[[Research]]`; relative Markdown paths depend on the folder containing the new task.

## Undo, archive and delete

The **↶** board button, **Undo** notification and **PikoBoard: Undo task action** command undo the most recent task property change, move, manual archive or restore. A move restores both status and card position. The action expires when another supported change replaces it or the plugin restarts.

Undo preserves independent description and journal edits. If the affected properties changed externally, it stops rather than overwriting them. Text editing has its own normal Cmd/Ctrl+Z history. Creating or deleting files and changing board configuration are outside task undo.

**Archive** hides tasks from active work but keeps their notes. Completed tasks are automatically archived after seven days by default. Checks run when the vault opens and once a minute while Obsidian is running. Restoring a completed task starts a new archive interval. Change or disable this behavior in settings.

The red trash button deletes the task note after confirmation, using **Obsidian → Files and links → Deleted files**. Recovery depends on that setting; PikoBoard does not provide task-file recovery.

## Folders and stored data

All configurable folders are inside the vault. Empty means the vault root. Changing a folder affects newly created files, without moving existing notes.

| Setting | Default | Contents |
| --- | --- | --- |
| New boards folder | Vault root | `.pikoboard` board files |
| New tasks folder | `Tasks` | Task notes |
| Attachments folder | `Attachments` | Files attached through PikoBoard |
| Research folder | `Materials` | New research notes |
| Projects folder | `Projects` | Project notes with `type: project` |
| Task templates folder | `Templates/PikoBoard` | Reusable task notes |

Each board can override its task and attachment folders through its folders menu. To share one attachment folder with ordinary notes, set the same path in PikoBoard and Obsidian's attachment settings; these preferences are independent.

Task properties include a `board` ID and the `task` tag. Journal and next-step sections use HTML comment markers in the note body. Keep these markers when editing the underlying note. Order, preferences, drafts, saved views and deleted-entry recovery live in the plugin's `data.json`.

Keep vault backups independently of PikoBoard. Syncing task notes alone does not transfer local plugin state, and simultaneous edits on different devices can still produce sync conflicts.

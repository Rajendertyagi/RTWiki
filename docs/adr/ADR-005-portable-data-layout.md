# ADR-005: Portable Data Layout Beside the Executable

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-08-19 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

RTWiki is distributed as a portable Windows artifact — a `.zip` file containing an executable and all runtime assets. The user extracts it and runs it. There is no installer, no registry entries, and no system-wide installation.

The application needs a place to store mutable data: the SQLite database, attachments, backups, and logs. Where should this data live?

Two fundamentally different approaches exist:

1. **Beside the executable** — all mutable files live in subdirectories of the folder that contains `RTWiki.exe`. The entire workspace travels with the application.
2. **In a system directory** — data is placed in `%LOCALAPPDATA%`, the user profile, or another OS-managed location. This separates the data from the application binary.

The owner requires true portability: the user must be able to move, copy, or rename the RTWiki folder and have the application continue working without reconfiguration. System directories break this guarantee because the data would remain behind when the folder is moved.

## Decision

RTWiki stores **all** mutable application files beside `RTWiki.exe` using a fixed directory structure determined at runtime from the executable's location, never from the current working directory.

### Directory Layout

```text
RTWiki/
├── RTWiki.exe
├── data/
│   ├── rtwiki.sqlite
│   ├── rtwiki.sqlite-wal
│   ├── rtwiki.sqlite-shm
│   ├── attachments/
│   └── backups/
└── logs/
    └── rtwiki.log
```

### How Paths Are Determined

At startup, the application resolves the absolute path of its own executable and derives every data path from it:

```
<directory_of_RTWiki.exe>/data/rtwiki.sqlite
<directory_of_RTWiki.exe>/data/attachments/
<directory_of_RTWiki.exe>/data/backups/
<directory_of_RTWiki.exe>/logs/rtwiki.log
```

No path is calculated from `process.cwd()`, `__dirname`, or any relative reference. The executable directory is resolved once and cached in the centralized typed configuration object.

### Centralized Configuration

Directory names and filenames are defined exactly once in the configuration module:

```typescript
const config = {
  data: {
    directory: path.join(exeDirectory, "data"),
    database: "rtwiki.sqlite",
    attachments: "attachments",
    backups: "backups",
  },
  logs: {
    directory: path.join(exeDirectory, "logs"),
    filename: "rtwiki.log",
  },
  // …
};
```

No module repeats the strings `"data"`, `"logs"`, `"attachments"`, `"backups"`, or `"rtwiki.sqlite"` anywhere else in the codebase.

### Startup Behaviour

On first launch the application:

1. Resolves the executable directory.
2. Creates `data/` and `logs/` if they do not exist.
3. Checks that the executable directory is writable by attempting to create a temporary file.
4. If the directory is **not writable**, the application displays a clear error message and exits:

   > "RTWiki cannot write to its data folder. Please move the RTWiki folder to a writable location such as Documents or Desktop, then try again."

5. The application **never** silently falls back to another location. If the executable directory is not writable, the application refuses to start.

### SQLite WAL Files

SQLite WAL mode is enabled. The WAL (`-wal`) and shutdown (`-shm`) files are stored in the same `data/` directory as the main database file. No WAL files are placed outside the data directory.

### Attachments

Allowed attachments are stored under `data/attachments/`. The storage path for each attachment is derived from the attachment's unique ID and the configured attachments subdirectory name.

### Backups

User-created backups are stored under `data/backups/`. A backup archive includes the database file and all attachments. Ordinary log files are **excluded** from backups.

### Logs

Application logs are stored under `logs/rtwiki.log`. Log files use rotation (by size and/or age) and retention limits so they cannot grow indefinitely. Logs never contain page content, pasted content, or other private document data.

### Portability Guarantees

- Moving or copying the complete `RTWiki/` folder preserves the workspace.
- Renaming the `RTWiki/` folder does not break the application.
- The application continues to work after the folder is moved to a different drive or computer.
- Runtime-created folders (`data/`, `logs/`) may be absent from a fresh ZIP download. The application creates them automatically on first launch.

## Alternatives Considered

| Alternative | Reason for Rejection |
|------------|---------------------|
| `%LOCALAPPDATA%\RTWiki` | Standard Windows location, but data is separated from the executable. Moving the application folder leaves data behind, breaking the portable guarantee. |
| User's home directory (`%USERPROFILE%\RTWiki`) | Same portability problem as LOCALAPPDATA. Also more visible to the user, which increases the chance of accidental deletion. |
| Registry-based data path | Requires an installer and administrative privileges. Contradicts the portable, no-install requirement. |
| `RTWIKI_DATA_DIR` environment variable override | Allows power users to relocate data, but introduces a second source of truth and creates confusion for non-technical users. The owner's requirement is that data stays beside the executable by design, not by configuration. |

## Consequences

**Positive:**
- True portability. The user can copy, move, or rename the RTWiki folder and everything works.
- No installer, no registry, no system-wide state.
- Backup is trivial: copy the `data/` folder or use the built-in backup feature.
- The application behaves predictably — there is only one location for data, and it is always beside the executable.
- Non-technical users do not need to understand paths, environment variables, or system directories.

**Negative:**
- If the user extracts the artifact to a read-only location (e.g., `Program Files`), the application will not start. The startup error message guides the user to a writable location.
- The data directory is less discoverable via Windows Explorer than `%LOCALAPPDATA%`. A non-technical user may not immediately know where to find it for manual backup. The built-in backup feature and the clear error message mitigate this.
- Antivirus software may occasionally flag an executable writing to its own directory. This is uncommon but possible.

**Neutral:**
- No environment variable override means no escape hatch for advanced users who want data on a different drive. This is intentional — the owner's requirement is portable-by-design, not configurable-by-override.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| User extracts to a read-only location (e.g., `Program Files`) | Low | Startup writable-directory check shows a clear error message directing the user to move the folder to Documents or Desktop. |
| User deletes the extracted folder and loses data | Medium | This is inherent to portable applications. The built-in backup feature mitigates this. The UI should surface backup as a regular habit. |
| Antivirus false positive on executable writing to its directory | Low | Uncommon. If it becomes a frequent issue, document the exception for the antivirus software. |
| User tries to share one data directory between multiple extracted copies | Low | Each extraction creates its own `data/` directory. Shared data is not supported and is not a required use case. |

## Revisit Conditions

This decision should be revisited only if:
- A future distribution model requires an installer (e.g., enterprise deployment with group policy).
- User feedback consistently indicates that a fixed system-directory location is strongly desired for a use case not covered by the portable model.
- A technical limitation makes the beside-executable approach infeasible (e.g., a dependency that requires writing to a fixed system path).

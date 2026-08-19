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

Two options are under consideration:

1. **Beside the executable** — data directory is created next to the `.exe` in the extracted folder.
2. **In `%LOCALAPPDATA%\RTWiki`** — data directory is in the user's standard application data folder.

The owner's preference is for a portable layout where the data travels with the application. This is an accepted decision.

## Decision

RTWiki stores mutable data in a `data/` directory **beside the executable** by default. When the user extracts the portable artifact, the application creates the following structure:

```
RTWiki/
├── RTWiki.exe
├── data/
│   ├── rtwiki.db          ← SQLite database
│   ├── attachments/       ← uploaded images, PDFs, documents
│   └── backups/           ← backup archives
├── logs/
│   └── app.log            ← structured application logs
└── dist/                  ← frontend assets (bundled by Vite)
```

The data directory path is determined at startup as follows:

```
<directory_containing_exe>/data/
```

An override is available via the environment variable `RTWIKI_DATA_DIR`. If set, the application uses that path instead. This allows power users to relocate the data directory if needed (e.g., to an external drive).

## Alternatives Considered

| Alternative | Reason for Rejection / Trade-off |
|------------|----------------------------------|
| `%LOCALAPPDATA%\RTWiki` | Standard Windows location. Easier for backups (user knows where to look). But data is separated from the executable, which breaks the "portable" feeling. If the user moves the executable, the data is left behind. |
| User's home directory (`%USERPROFILE%\RTWiki`) | Similar to LOCALAPPDATA but more visible. Same portability problem. |
| Application data beside executable (chosen) | Data travels with the executable. True portability. User can move or copy the entire folder. Slightly less discoverable for manual backup. |

## Consequences

**Positive:**
- The application is truly portable. Copy the folder, and everything goes with it.
- No permissions issues — the data directory is in a user-writable location ( wherever the user extracted the zip).
- The user can keep multiple workspace copies by extracting to different folders.
- Backup is straightforward — copy the `data/` folder or use the application's built-in backup feature.

**Negative:**
- The data directory is less discoverable than `%LOCALAPPDATA%`. A non-technical user may not know where to find it for manual backup.
- If the user extracts the portable artifact to a read-only location (e.g., `Program Files`), the application will fail to start. The application should detect this and show a clear error message.
- Antivirus software may flag an executable writing to its own directory. This is uncommon but possible.

**Neutral:**
- The `RTWIKI_DATA_DIR` environment variable provides an escape hatch for advanced users without complicating the default experience.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| User extracts to a read-only location | Low | The application checks write permissions at startup and shows a clear error message if the data directory cannot be created. |
| User loses data by deleting the extracted folder | Medium | This is the nature of portable applications. The built-in backup feature mitigates this risk. Document the backup process clearly in the UI. |
| Multiple installations sharing the same data directory | Low | Each extraction creates its own `data/` directory. If the user wants shared data, they can set `RTWIKI_DATA_DIR` to a common location. |

## Revisit Conditions

This decision should be revisited if:
- Users consistently request a fixed data location (e.g., for group policy backup or enterprise deployment).
- The portable artifact approach is abandoned in favour of an installer-based distribution.
- Antivirus false positives become a frequent support issue.

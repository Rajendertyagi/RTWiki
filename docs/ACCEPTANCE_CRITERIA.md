# Acceptance Criteria

This document defines measurable, observable pass/fail criteria for the MVP. Each criterion is written so that a non-technical reviewer can verify it by interaction alone — no code inspection is required. Criteria are grouped by capability.

## 1. Offline Operation

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-001 | The application starts and functions with the network cable disconnected (or Wi-Fi turned off). | All pages load, editing works, search returns results, and no error about missing network is shown. |
| AC-002 | No network request is made to any external domain during normal operation. | A packet capture tool (e.g., Wireshark) shows zero outbound connections while the application is running. |
| AC-003 | All UI assets (JavaScript, CSS, icons, fonts) are bundled locally. | Inspecting the page source in a browser shows no `<link>` or `<script>` tags pointing to `https://` or `http://` external URLs. |

## 2. Page Management

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-004 | A user can create a new page by clicking a "New Page" button and entering a title. | A new page appears in the page list within 2 seconds of clicking Save. |
| AC-005 | A user can rename a page by editing its title. | The new title appears in the sidebar and the page URL (if visible) reflects the change after saving. |
| AC-006 | A user can delete a page. | The page disappears from the main view and appears in a "Recycle Bin" section. The data is not permanently erased. |
| AC-007 | A user can restore a deleted page from the recycle bin. | The page reappears in the main view with all its content intact. |
| AC-008 | A user can permanently delete a page from the recycle bin after explicit confirmation. | A confirmation dialog asks "Are you sure?" and the page is gone afterward. |
| AC-009 | A user can duplicate an existing page. | A copy with a distinct title (original title + "Copy") appears in the list with identical content. |

## 3. Block Editor

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-010 | A user can type text and see it appear as a paragraph block. | Text is visible in the editor immediately as it is typed. |
| AC-011 | A user can change a block to a heading (H1, H2, or H3). | The block text renders larger/bolder and the slash menu or toolbar shows the heading option selected. |
| AC-012 | A user can create a bulleted list, a numbered list, and a checklist. | Each list type renders with the correct marker (bullet, number, checkbox). Checklist items show an interactive checkbox. |
| AC-013 | A user can insert a blockquote. | The block renders with a left border or indentation indicating quote style. |
| AC-014 | A user can insert a table with at least 2 columns and 2 rows. | The table is visible in the editor and editable. |
| AC-015 | A user can insert a code block and see syntax highlighting. | The code block has a distinct background colour and monospace font. |
| AC-016 | A user can drag and drop a block to a new position. | The block moves to the target position on drop and stays there after release. |
| AC-017 | A user can open the slash menu by typing `/`. | A menu appears listing available block types. Selecting one inserts that block type. |
| AC-018 | A user can apply bold and italic formatting to selected text. | The selected text appears bold or italic respectively. |

## 4. Import and Export

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-019 | A user can paste HTML content from a browser or AI response. | The pasted content appears as editable blocks in the editor, not as raw HTML source. |
| AC-020 | A user can paste Markdown text. | The Markdown is converted into formatted blocks (headings become headings, lists become lists, etc.). |
| AC-021 | A user can switch to source input mode and type raw HTML. | The HTML is rendered as formatted content when the user exits source mode. |
| AC-022 | A user can switch to source input mode and type raw Markdown. | The Markdown is rendered as formatted content when the user exits source mode. |
| AC-023 | Pasted HTML containing `<script>` tags does not execute JavaScript. | After pasting, no alert box or side effect occurs. The script tag is stripped from the content. |

## 5. Advanced Blocks

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-024 | A user can insert a Card block and add blocks inside it. | The card renders as a visually grouped container with a border or background. |
| AC-025 | A user can insert a Tabs block with at least two tabs. | Clicking each tab shows the content of the corresponding tab and hides the others. |
| AC-026 | A user can insert an inline mathematical formula. | The formula renders as properly formatted math notation next to surrounding text. |
| AC-027 | A user can insert a block mathematical formula. | The formula renders centered on its own line as properly formatted math notation. |
| AC-028 | A user can insert a Mermaid diagram (including a mind map). | The diagram renders as a visual graphic within the page. |

## 6. Attachments

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-029 | A user can upload an image file (PNG, JPG, GIF). | The image appears in the page and can be viewed by clicking it. |
| AC-030 | A user can upload a PDF file. | The PDF appears as an attachable file in the page with a download link. |
| AC-031 | A user can upload a document file (DOCX, ODT, TXT, MD). | The file appears as an attachable file in the page with a download link. |
| AC-032 | An upload of a file with a disallowed extension is rejected. | The application shows an error message and the file is not stored. |
| AC-033 | An upload of a file exceeding the size limit is rejected. | The application shows an error message and the file is not stored. |

## 7. Page Organization

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-034 | A user can add one or more tags to a page. | The tags appear on the page and in the tag list. |
| AC-035 | A user can filter pages by tag. | Only pages with the selected tag are shown in the filtered view. |
| AC-036 | A user can insert a link to another page. | The linked page name appears as a clickable link. Clicking it navigates to that page. |
| AC-037 | Backlinks are visible on a page. | When Page A links to Page B, Page B shows a "Backlinks" section listing Page A. |

## 8. Search

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-038 | A user can type a search query and see matching pages. | Results appear within 1 second for a workspace of up to 500 pages. |
| AC-039 | Search results include a content snippet showing the matched text. | The snippet highlights the search term and is taken from the page content. |
| AC-040 | Search is case-insensitive. | Searching for "hello" finds pages containing "Hello" or "HELLO". |
| AC-041 | Searching for a term that does not exist shows an empty results state. | A clear message such as "No pages found" is displayed. |

## 9. Autosave, Undo, and Redo

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-042 | Changes are autosaved after a short delay following the last keystroke. | A "Saving…" indicator appears during write, then changes to "Saved" within 3 seconds. |
| AC-043 | A user can undo the last action with Ctrl+Z. | The last change is reversed visually in the editor. |
| AC-044 | A user can redo a previously undone action with Ctrl+Y. | The undone change is restored visually in the editor. |
| AC-045 | If the application crashes, the most recent autosaved content is recoverable on restart. | On restart, the page shows the content that was saved before the crash, not an empty page. |

## 10. Backup and Restore

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-046 | A user can create a backup archive. | A `.zip` file is produced and saved to a user-selected location. |
| AC-047 | The backup archive contains the database, attachments, and metadata. | Extracting the archive shows the expected files. |
| AC-048 | A user can restore from a valid backup archive. | After restore, all pages, tags, attachments, and search index are present and correct. |
| AC-049 | A restore from a corrupted or invalid archive is rejected. | The application shows a clear error message and makes no changes to the live data. |
| AC-050 | Backup metadata (timestamp, size, version) is displayed to the user. | The backup screen shows when the backup was created, its file size, and the RTWiki version. |

## 11. Themes

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-051 | A user can switch between light and dark themes. | The UI colours change immediately after toggling the theme switch. |
| AC-052 | The chosen theme persists across application restarts. | After restarting, the same theme is active without requiring a manual switch. |

## 12. User Interface

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-053 | The layout is responsive and usable on a window resized to tablet width (768 px). | All navigation elements remain accessible and content is readable without horizontal scrolling. |
| AC-054 | All primary workflows are operable using only the keyboard. | A user can create, edit, save, search, and navigate pages using Tab, Enter, Escape, and arrow keys. |
| AC-055 | Error messages are understandable by a non-technical user. | Error messages use plain language (e.g., "Could not save the page. Please try again.") instead of technical codes. |

## 13. Windows Portable Artifact

| ID | Criterion | Pass Condition |
|----|----------|---------------|
| AC-056 | The downloadable artifact is a `.zip` file containing an `.exe` and all runtime assets. | Extracting the zip shows a single executable and a `data/` directory template. |
| AC-057 | Running the `.exe` starts the application without requiring any installed runtime. | The application launches and opens in the default browser. No error about missing Bun, Node, or .NET is shown. |
| AC-058 | The application stores user data outside the executable directory. | After first run, a `data/` directory exists in `%LOCALAPPDATA%\RTWiki` (or the configured path), not beside the `.exe`. |

## 14. Non-Functional Targets

| ID | Criterion | Target |
|----|----------|--------|
| AC-059 | Time to first paint after launching the executable | ≤ 3 seconds on a typical home PC (4 cores, 8 GB RAM) |
| AC-060 | Time to save a page after the last keystroke (debounce) | ≤ 2 seconds |
| AC-061 | Time to perform a search across 500 pages | ≤ 1 second |
| AC-062 | Size of the portable Windows artifact | ≤ 150 MB |

## Cross-References

- [MVP_SCOPE.md](MVP_SCOPE.md) — what features these criteria cover
- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) — the requirements each criterion validates
- [ROADMAP.md](ROADMAP.md) — features beyond the MVP that will have their own criteria later

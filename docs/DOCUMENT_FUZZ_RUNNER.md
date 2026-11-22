# Random document fuzz runner

A dev-only script that generates random files for every document format RTWiki
accepts, uploads each to the **built** app, checks the result, and cleans up.
It is deliberately separate from `bun test` so it never slows the normal suite.

## Run it

```bash
# Routine run (about 200 files, a few minutes), random seed
bun scripts/ci/random-document-runner.ts

# Reproducible run with a fixed seed
bun scripts/ci/random-document-runner.ts --seed 12345

# Big files near the 50 MB warning and 100 MB ceiling (slow, opt-in)
bun scripts/ci/random-document-runner.ts --big

# Include real files from a folder outside the repo
bun scripts/ci/random-document-runner.ts --real-files D:\my-real-docs

# Choose where failing files and reports are kept (default: OS temp folder)
bun scripts/ci/random-document-runner.ts --failure-dir D:\fuzz-failures
```

Other options: `--portable <dir>`, `--shell <exe>`, `--server <exe>`.

## What it does

1. **Validates the generator first.** Every good file produced by
   `OfficeGenerator` must upload with its marker words coming back out. If one
   fails, the report says "generator problem or app problem?" — it is not
   counted as an app bug without checking.
2. **Good files** from two sources: `OfficeGenerator` (realistic structure) and
   hand-built files (PDF, text formats). Random content includes English,
   Arabic, Chinese, emoji and accents, long lines, empty parts, tables,
   headings and lists. Marker words must appear in the extracted text; empty or
   wrong text is a failure. Macro/template variants (`docm`, `dotx`, `dotm`,
   `pptm`, `potx`, `potm`, `ppsx`, `ppsm`, `xlsm`, `xltx`, `xltm`) are **not**
   built from scratch: a real `docx`/`pptx`/`xlsx` is generated first, then its
   ZIP is repackaged with the variant's main-part content-type. Every other
   part is kept, and the repackaged file must still return its markers before
   it counts as good.
3. **Damaged files** made fresh from good ones: truncated, bytes flipped, wrong
   extension, and a plain zip. Pass rules differ by format family:
   - **Text formats** (`txt`, `html`, `csv`, `md`, `tex`): a cut-short or
     byte-flipped file is still normal text. Passing means no crash, no hang,
     and either a clear refusal **or** a 201 with some (even partial) text. A
     refusal is not required.
   - **Binary/container formats** (PDF, DOCX/XLSX/PPTX and all macro/template
     variants, ODT/ODP/ODS/ODG, EPUB, RTF): the strict rule applies — a clear
     refusal with a meaningful message. A plain zip must be refused.
   The exact message shown is printed for every damaged file.
4. **Hang watch:** each upload has a wall-clock timeout measured by the script.
   On a hang it records the hang, restarts the app, and continues.
5. **Isolation:** the app runs from a copy of the portable folder in a temp
   directory with its own fresh `data/`. Your real portable folder, data and
   settings are never touched. The test port is 18080, not 8080/8888.
6. **Cleanup:** generated files are deleted when they pass. Failing files and
   their reason are kept in the failure folder (outside the repo by default).

## Reading the table

One row per format, with a **source** label (`generator`, `handbuilt`,
`fixture`, `real`):

| column | meaning |
|---|---|
| format | format extension (or `real:<name>`) |
| source | where the file came from |
| files | number of files tried |
| passed | files that met the check |
| failed | files that did not — see the failure folder |
| accepted | damaged-phase uploads the app accepted (201) — watch this for a sudden rise |
| refused | damaged-phase uploads the app refused (4xx) — the strict refusals that must stay |
| hangs | uploads that timed out (app was restarted) |
| skipped | files not uploaded because that format/source's generator was marked broken |
| slowest_ms | slowest upload for this format |
| seed | the run's seed — reuse it to reproduce |
| note | `generator_broken` / `handbuilt_broken` when a generator failed its first check and the rest of that format/source was skipped |

A generator is marked broken as soon as its **first** check fails — either the
Phase 1 generator validation or the first good-file upload for that
format/source. Every remaining file from that source is then skipped and
counted in `skipped`, so one broken generator cannot flood the table with
failures. The table is also saved to `<failure-dir>/report-<seed>.txt`.

## Real files

Put a few real files from real programs in a folder outside the repo and pass
`--real-files <dir>`. Only the small name/extension/expected-words list lives in
`scripts/ci/random-document-manifest.json`; the files themselves stay outside
the repository.

## Formats that cannot be generated

Password-protected Office files, real macro files with VBA, old `.doc`/`.xls`/
`.ppt`, and real-world producer variations need real files. The repo's
`tests/fixtures/` already holds password-protected and real macro samples used
by the unit tests; the optional real-files folder covers the rest.

**Multilingual PDF is a known gap.** The hand-built PDF uses the Helvetica /
latin1 font, which cannot represent Arabic, Chinese, emoji or accented letters,
so its generator is constrained to plain ASCII English. Testing non-Latin PDF
text requires a real PDF supplied through `--real-files`; the generated PDFs
in this runner deliberately do not cover it.

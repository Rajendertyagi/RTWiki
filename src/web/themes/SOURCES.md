# Theme sources and licenses

Themes in this folder are colour data sourced from third-party palettes. Their
source URLs, authors and licenses are recorded here for attribution.

## default

- **Source:** RTWiki's own theme, transcribed from TriliumNext's token palette
  (`docs/trilium-uiux-reference.md`).
- **License:** part of RTWiki.

## pastel-dreams

- **Source:** https://tweakcn.com/r/themes/pastel-dreams.json
- **Upstream project:** https://github.com/jnsahaj/tweakcn
- **License:** Apache License 2.0 (https://github.com/jnsahaj/tweakcn/blob/main/LICENSE)
- **Attribution:** colour values from the tweakcn "pastel-dreams" theme; mapped
  into RTWiki's token vocabulary. The upstream Apache-2.0 notice is retained in
  `THIRD_PARTY_NOTICES.md` at the repository root.

## catppuccin

- **Source:** https://tweakcn.com/r/themes/catppuccin.json
- **Upstream palettes:** https://github.com/catppuccin/catppuccin
- **License:** MIT (https://github.com/catppuccin/catppuccin/blob/main/LICENSE)
- **Attribution:** colour values derived from Catppuccin via the tweakcn theme;
  mapped into RTWiki's token vocabulary. The upstream MIT notice is retained in
  `THIRD_PARTY_NOTICES.md` at the repository root.

## vercel

- **Source:** https://tweakcn.com/r/themes/vercel.json
- **Upstream project:** https://github.com/jnsahaj/tweakcn
- **License:** Apache License 2.0 (https://github.com/jnsahaj/tweakcn/blob/main/LICENSE)
- **Attribution:** colour values from the tweakcn "vercel" theme; mapped into
  RTWiki's token vocabulary. The upstream Apache-2.0 notice is retained in
  `THIRD_PARTY_NOTICES.md` at the repository root.

## Mapping rule

Tweakcn supplies semantic colour variables, not RTWiki's token vocabulary.
Values that land in an RTWiki slot unchanged are copied verbatim (e.g.
`background` → `canvas`, `foreground` → `text`, `card` → `pane`,
`muted-foreground` → `textMuted`, `border` → `border`). Values with no direct
slot (`primary`, `secondary`, `accent`, `destructive`, `chart-*`, `sidebar-*`)
are mapped by a documented rule. RTWiki's structural region ladder
(`canvas/pane/rail/elevated`) and interaction tokens are authored to satisfy
the registry invariants; every synthesized value is reported in the theme
generation notes, not claimed as unchanged.

/**
 * Shared class-name constants. Kept separate from the registry so the theme
 * factory can use them without importing the registry (which uses Vite's
 * import.meta.glob). The registry re-exports them for existing import paths.
 */

/** The one class every floating surface carries. Defined in customization.css. */
export const FLOATING = 'rtwiki-floating'

/** The notification toast carries the floating recipe plus its own class. */
export const NOTIFICATION = 'rtwiki-notification'

/**
 * The shared native-scrollbar class, applied to scroll containers a library
 * owns and to one-dimensional strips inside rendered text. It lives in
 * customization.css because it must reach DOM no component here renders.
 */
export const RTWIKI_SCROLL = 'rtwiki-scroll'

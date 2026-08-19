/**
 * `__APP_VERSION__` is injected from package.json at build time.
 *
 * A trailing `.0` patch is trimmed for display, so the semver `0.1.0` in
 * package.json reads as the "0.1" it actually is. A real patch release
 * (`0.1.1`) shows in full.
 */
export const APP_VERSION = __APP_VERSION__.replace(/\.0$/, '')

export const COPYRIGHT_HOLDER = 'Avery LLC'

/**
 * Theme preference: light, dark, or follow the operating system.
 *
 * The choice is written to `data-theme` on `<html>`, which the palettes in
 * `globals.css` key off. "system" removes the attribute entirely rather than
 * resolving it here, so the CSS media query stays the single source of truth
 * and the page follows the OS live — without this component re-rendering.
 */

export const THEME_STORAGE_KEY = "analyst.theme";

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/** Apply a choice to the document. Safe to call before hydration. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function readStoredTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    // Private browsing and blocked storage both throw here. Following the OS
    // is a perfectly good outcome, so this is not worth surfacing.
    return "system";
  }
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The theme still applies for this page view; it just will not persist.
  }
}

/**
 * Runs before first paint, from a blocking inline script in `layout.tsx`.
 *
 * Without it the document renders with the system palette and then snaps to the
 * stored one — a flash of the wrong theme on every load. Inline `<script>` is
 * already permitted by the CSP (`script-src` carries `'unsafe-inline'` for the
 * App Router's hydration payload), so this needs no policy change.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

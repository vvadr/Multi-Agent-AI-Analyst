import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names, letting a later Tailwind utility beat an earlier one in the
 * same group.
 *
 * Without the merge, a component that sets `px-4` internally and accepts a
 * `className` of `px-8` emits both and the winner depends on stylesheet order
 * rather than on the caller's intent.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

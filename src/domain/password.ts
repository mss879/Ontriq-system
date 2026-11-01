/**
 * Password rules, shared by every form that sets one. Hosted Auth enforces the
 * same 10-character minimum (supabase/config.toml).
 */

import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "That password is too long.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

// No 0, O, 1, l or I, because these get read out and typed by hand.
const LETTERS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** A password to share with someone: 14 characters, and always meets the rules above. */
export function generatePassword(): string {
  const all = LETTERS + DIGITS;
  const random = crypto.getRandomValues(new Uint32Array(14));
  const chars = Array.from(random, (n) => all[n % all.length]);
  chars[random[0] % 7] = LETTERS[random[1] % LETTERS.length];
  chars[7 + (random[2] % 7)] = DIGITS[random[3] % DIGITS.length];
  return chars.join("");
}

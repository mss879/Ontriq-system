/**
 * Sri Lankan National Identity Card numbers. Pure: safe on server, client and worker.
 *
 * Old format: YY DDD SSS C + V/X (9 digits and a letter), issued until 2016.
 * New format: YYYY DDD SSSS C (12 digits).
 * DDD is the day of the year of birth, counted as if February always had 29
 * days, plus 500 for women. An old number converts to the new one as
 * 19YY DDD 0 SSS C, which is the canonical form used to match the same person
 * across cases whichever card they show.
 */

export type NicInfo =
  | { valid: true; format: "old" | "new"; canonical: string; display: string; birthDate: string; gender: "male" | "female" }
  | { valid: false; error: string };

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function parseNic(input: string, today: Date = new Date()): NicInfo {
  const raw = (input ?? "").replace(/[\s-]/g, "").toUpperCase();
  let year: number;
  let dayCode: number;
  let canonical: string;
  let format: "old" | "new";

  if (/^\d{9}[VX]$/.test(raw)) {
    format = "old";
    year = 1900 + Number(raw.slice(0, 2));
    dayCode = Number(raw.slice(2, 5));
    canonical = `${year}${raw.slice(2, 5)}0${raw.slice(5, 9)}`;
  } else if (/^\d{12}$/.test(raw)) {
    format = "new";
    year = Number(raw.slice(0, 4));
    dayCode = Number(raw.slice(4, 7));
    canonical = raw;
  } else {
    return { valid: false, error: "Use 9 digits followed by V or X, or the new 12-digit number." };
  }

  const gender = dayCode > 500 ? "female" : "male";
  let day = dayCode > 500 ? dayCode - 500 : dayCode;
  if (day < 1 || day > 366) return { valid: false, error: "The birth day in this NIC number is not valid." };
  if (year < 1900 || year > today.getFullYear()) return { valid: false, error: "The birth year in this NIC number is not valid." };

  let month = 0;
  while (day > MONTH_DAYS[month]) {
    day -= MONTH_DAYS[month];
    month += 1;
  }
  if (month === 1 && day === 29 && !isLeap(year)) return { valid: false, error: "This NIC number gives 29 February in a non-leap year." };

  const birthDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { valid: true, format, canonical, display: raw, birthDate, gender };
}

/** The matching key for a NIC, or null when it isn't a valid number. */
export function canonicalNic(input: string | null | undefined): string | null {
  if (!input) return null;
  const parsed = parseNic(input);
  return parsed.valid ? parsed.canonical : null;
}

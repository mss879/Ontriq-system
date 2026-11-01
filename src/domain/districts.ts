/** The 25 administrative districts of Sri Lanka, used for address checks and regional assignment. */
export const DISTRICTS = [
  "Ampara",
  "Anuradhapura",
  "Badulla",
  "Batticaloa",
  "Colombo",
  "Galle",
  "Gampaha",
  "Hambantota",
  "Jaffna",
  "Kalutara",
  "Kandy",
  "Kegalle",
  "Kilinochchi",
  "Kurunegala",
  "Mannar",
  "Matale",
  "Matara",
  "Monaragala",
  "Mullaitivu",
  "Nuwara Eliya",
  "Polonnaruwa",
  "Puttalam",
  "Ratnapura",
  "Trincomalee",
  "Vavuniya",
] as const;

export type District = (typeof DISTRICTS)[number];

/** A candidate can live abroad. Address and police checks still have to record that honestly. */
export const OUTSIDE_SRI_LANKA = "Outside Sri Lanka";
export const DISTRICT_CHOICES: readonly string[] = [...DISTRICTS, OUTSIDE_SRI_LANKA];

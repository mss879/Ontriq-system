# Colombo dates

`0043_colombo_dates.sql`. The hosted database runs in UTC. Between midnight and 05:30 in Colombo its date is still yesterday, so a contracted price accepted in those hours wasn't found by a lookup using the UTC date. Price lookups now default to the date in Colombo.

`npm run db:verify` now runs its database in UTC, like the hosted one. Before, it took the machine's time zone, which hid this bug on a Sri Lankan laptop. CI found it because GitHub's runners use UTC.

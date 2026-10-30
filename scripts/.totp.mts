import pg from "pg";
import { totp } from "./local-stack/totp";
const c = new pg.Client({ connectionString: "postgresql://postgres@127.0.0.1:55433/ontriq" });
await c.connect();
const { rows } = await c.query("select f.secret from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = $1 order by f.created_at desc limit 1", [process.argv[2]]);
await c.end();
const secs = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(totp(rows[0].secret), `valid ${secs}s`);

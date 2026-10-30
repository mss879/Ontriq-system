import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type JsonWebKey, type KeyObject } from "node:crypto";

export type KeySet = { kid: string; privateJwk: JsonWebKey; publicJwk: JsonWebKey };

export const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function generateKeySet(): KeySet {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = `local-${Date.now().toString(36)}`;
  return {
    kid,
    privateJwk: privateKey.export({ format: "jwk" }),
    publicJwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig", key_ops: ["verify"] } as JsonWebKey,
  };
}

export class Signer {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  constructor(private readonly keys: KeySet) {
    this.privateKey = createPrivateKey({ key: keys.privateJwk, format: "jwk" });
    this.publicKey = createPublicKey({ key: keys.publicJwk, format: "jwk" });
  }

  jwks() {
    return { keys: [this.keys.publicJwk] };
  }

  sign(payload: Record<string, unknown>): string {
    const header = { alg: "ES256", typ: "JWT", kid: this.keys.kid };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = sign("sha256", Buffer.from(input), { key: this.privateKey, dsaEncoding: "ieee-p1363" });
    return `${input}.${b64url(signature)}`;
  }

  verify(token: string): Record<string, unknown> | null {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: this.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload;
  }
}

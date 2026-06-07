// FIXED: verifies the ES256 signature and asserts issuer + audience.
import { jwtVerify, importSPKI } from "jose";

export async function verifyPrivyToken(token: string) {
  const appId = process.env.PRIVY_APP_ID ?? "";
  const key = await importSPKI(process.env.PRIVY_VERIFICATION_KEY ?? "", "ES256");
  const { payload } = await jwtVerify(token, key, { issuer: "privy.io", audience: appId });
  return { userId: payload.sub };
}

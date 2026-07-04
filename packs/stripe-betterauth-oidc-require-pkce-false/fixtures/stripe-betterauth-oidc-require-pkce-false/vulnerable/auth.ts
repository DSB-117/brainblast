import { betterAuth } from "better-auth";
import { oidcProvider } from "better-auth/plugins";

// Auth builder — the audited scope.
export function buildAuth() {
  return betterAuth({
    plugins: [
      // VULNERABLE: PKCE enforcement off — authorization codes accepted with no
      // code_verifier binding (authorization-code interception).
      oidcProvider({
        loginPage: "/sign-in",
        requirePKCE: false,
      }),
    ],
  });
}

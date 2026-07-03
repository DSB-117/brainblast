import { betterAuth } from "better-auth";
import { oidcProvider } from "better-auth/plugins";

// Auth builder — the audited scope.
export function buildAuth() {
  return betterAuth({
    plugins: [
      // FIXED: only S256 accepted — the authorization request carries a hash, not the verifier.
      oidcProvider({
        loginPage: "/sign-in",
        requirePKCE: true,
        allowPlainCodeChallengeMethod: false,
      }),
    ],
  });
}

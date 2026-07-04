import { betterAuth } from "better-auth";
import { oidcProvider } from "better-auth/plugins";

// Auth builder — the audited scope.
export function buildAuth() {
  return betterAuth({
    plugins: [
      // VULNERABLE: 'plain' code_challenge_method accepted — the verifier travels
      // in the clear, defeating PKCE.
      oidcProvider({
        loginPage: "/sign-in",
        requirePKCE: true,
        allowPlainCodeChallengeMethod: true,
      }),
    ],
  });
}

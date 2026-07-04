import { betterAuth } from "better-auth";
import { oidcProvider } from "better-auth/plugins";

// Auth builder — the audited scope.
export function buildAuth() {
  return betterAuth({
    plugins: [
      // FIXED: PKCE required for every authorization-code flow (OAuth 2.1 mandated).
      oidcProvider({
        loginPage: "/sign-in",
        requirePKCE: true,
      }),
    ],
  });
}

import ldap from "ldapjs";

export function makeLdapClient(url: string, ca: string) {
  // FIXED: certificate validation enforced; trust the directory CA explicitly.
  return ldap.createClient({ url, tlsOptions: { rejectUnauthorized: true, ca } });
}

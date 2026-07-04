import ldap from "ldapjs";

export function makeLdapClient(url: string) {
  // VULNERABLE: tlsOptions.rejectUnauthorized: false — LDAP bind credentials can be MITM'd.
  return ldap.createClient({ url, tlsOptions: { rejectUnauthorized: false } });
}

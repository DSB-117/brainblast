// A generic logging helper — fine on its own, but a problem if a caller
// (anywhere in the project) ever passes it a secret.
export function logIt(value: unknown) {
  console.log("debug:", value);
}

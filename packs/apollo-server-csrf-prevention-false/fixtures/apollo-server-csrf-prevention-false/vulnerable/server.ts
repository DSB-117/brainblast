import { ApolloServer } from "@apollo/server";

export function makeApollo(typeDefs: string, resolvers: object) {
  // VULNERABLE: csrfPrevention: false lets simple cross-site requests drive authenticated mutations.
  return new ApolloServer({ typeDefs, resolvers, csrfPrevention: false });
}

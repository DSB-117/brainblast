import { ApolloServer } from "@apollo/server";

export function makeApollo(typeDefs: string, resolvers: object) {
  // FIXED: CSRF prevention stays enabled (the Apollo Server 4 default).
  return new ApolloServer({ typeDefs, resolvers, csrfPrevention: true });
}

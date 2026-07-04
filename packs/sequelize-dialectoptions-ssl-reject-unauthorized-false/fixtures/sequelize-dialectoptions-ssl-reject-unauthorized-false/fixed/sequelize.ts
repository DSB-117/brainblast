import { Sequelize } from "sequelize";

export function makeSequelize(url: string, ca: string) {
  // FIXED: certificate validation enforced; trust the provider's CA explicitly.
  return new Sequelize(url, { dialect: "postgres", dialectOptions: { ssl: { rejectUnauthorized: true, ca } } });
}

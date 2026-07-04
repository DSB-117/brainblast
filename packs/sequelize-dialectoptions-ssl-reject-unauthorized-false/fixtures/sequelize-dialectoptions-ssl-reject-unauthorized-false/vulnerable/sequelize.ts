import { Sequelize } from "sequelize";

export function makeSequelize(url: string) {
  // VULNERABLE: dialectOptions.ssl.rejectUnauthorized: false — the DB certificate is not validated.
  return new Sequelize(url, { dialect: "postgres", dialectOptions: { ssl: { rejectUnauthorized: false } } });
}

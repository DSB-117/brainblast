import { Kafka } from "kafkajs";

export function makeKafka(brokers: string[]) {
  // VULNERABLE: ssl.rejectUnauthorized: false — the broker certificate is not validated.
  return new Kafka({ clientId: "app", brokers, ssl: { rejectUnauthorized: false } });
}

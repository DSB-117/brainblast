import { Kafka } from "kafkajs";

export function makeKafka(brokers: string[], ca: string) {
  // FIXED: certificate validation enforced; trust the broker CA explicitly.
  return new Kafka({ clientId: "app", brokers, ssl: { rejectUnauthorized: true, ca } });
}

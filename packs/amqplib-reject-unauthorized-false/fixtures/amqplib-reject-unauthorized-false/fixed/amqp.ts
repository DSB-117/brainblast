import amqp from "amqplib";

export function connectBroker(url: string, ca: string) {
  // FIXED: certificate validation enforced; trust the broker CA explicitly.
  return amqp.connect(url, { rejectUnauthorized: true, ca: [ca] });
}

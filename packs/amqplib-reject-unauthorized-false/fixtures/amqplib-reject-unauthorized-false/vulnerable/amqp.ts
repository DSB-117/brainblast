import amqp from "amqplib";

export function connectBroker(url: string) {
  // VULNERABLE: rejectUnauthorized: false — the RabbitMQ broker certificate is not validated.
  return amqp.connect(url, { rejectUnauthorized: false });
}

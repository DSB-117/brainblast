import mqtt from "mqtt";

export function connectBroker(url: string, ca: string) {
  // FIXED: certificate validation enforced; trust the broker CA explicitly.
  return mqtt.connect(url, { rejectUnauthorized: true, ca, reconnectPeriod: 1000 });
}

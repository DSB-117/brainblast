import mqtt from "mqtt";

export function connectBroker(url: string) {
  // VULNERABLE: rejectUnauthorized: false — the MQTT broker certificate is not validated.
  return mqtt.connect(url, { rejectUnauthorized: false, reconnectPeriod: 1000 });
}

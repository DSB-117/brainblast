import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeNetwork, _parseEnvFile } from "../src/wallet/envConfig.ts";
import { analyzeWallet } from "../src/wallet/analyze.ts";

const ADAPTER_IMPORT = `import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";\nimport { WalletAdapterNetwork } from "@solana/wallet-adapter-base";\nimport { clusterApiUrl } from "@solana/web3.js";\n`;

describe("envConfig", () => {
  it("normalizes network values", () => {
    expect(normalizeNetwork("devnet")).toBe("devnet");
    expect(normalizeNetwork("mainnet-beta")).toBe("mainnet");
    expect(normalizeNetwork('"MainNet"')).toBe("mainnet");
    expect(normalizeNetwork("http://localhost:8899")).toBe("localnet");
    expect(normalizeNetwork("hello")).toBeNull();
  });

  it("detects an exposed RPC key under a client-exposed prefix", () => {
    const { exposedKeys } = _parseEnvFile("NEXT_PUBLIC_RPC=https://mainnet.helius-rpc.com/?api-key=abc123DEF456ghi", ".env");
    expect(exposedKeys).toHaveLength(1);
    expect(exposedKeys[0].provider).toBe("Helius");
  });

  it("does NOT flag a keyed URL under a server-only var", () => {
    const { exposedKeys } = _parseEnvFile("SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=abc123DEF456ghi", ".env");
    expect(exposedKeys).toHaveLength(0);
  });
});

describe("analyzeWallet", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wallet-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const write = (name: string, content: string) => writeFileSync(join(dir, name), content);

  it("BLOCKS on a devnet .env wired to a hardcoded mainnet endpoint", () => {
    write(".env", "NEXT_PUBLIC_SOLANA_NETWORK=devnet\n");
    write("App.tsx", ADAPTER_IMPORT + "const endpoint = clusterApiUrl(WalletAdapterNetwork.Mainnet);\n<ConnectionProvider endpoint={endpoint} />");
    const r = analyzeWallet(dir);
    expect(r.verdict).toBe("block");
    expect(r.findings.some((f) => f.id === "solana-wallet-network-mismatch")).toBe(true);
  });

  it("flags a declared-but-unwired network env var (high)", () => {
    write(".env", "NEXT_PUBLIC_SOLANA_NETWORK=devnet\n");
    write("App.tsx", ADAPTER_IMPORT + "const endpoint = clusterApiUrl(WalletAdapterNetwork.Devnet);"); // hardcoded devnet, not from env
    const r = analyzeWallet(dir);
    expect(r.findings.some((f) => f.id === "solana-network-env-unwired")).toBe(true);
    expect(r.verdict).toBe("warn");
  });

  it("passes when the endpoint is wired to the network env var", () => {
    write(".env", "NEXT_PUBLIC_SOLANA_NETWORK=devnet\n");
    write(
      "App.tsx",
      ADAPTER_IMPORT +
        "import '@solana/wallet-adapter-react-ui/styles.css';\n" +
        "const net = process.env.NEXT_PUBLIC_SOLANA_NETWORK;\nconst endpoint = clusterApiUrl(net);\n<ConnectionProvider endpoint={endpoint} />",
    );
    const r = analyzeWallet(dir);
    expect(r.verdict).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("flags the public mainnet RPC", () => {
    write(".env", "NEXT_PUBLIC_SOLANA_NETWORK=mainnet\n");
    write("App.tsx", ADAPTER_IMPORT + "const net = process.env.NEXT_PUBLIC_SOLANA_NETWORK;\nconst endpoint = clusterApiUrl('mainnet-beta');");
    const r = analyzeWallet(dir);
    expect(r.findings.some((f) => f.id === "solana-public-rpc-endpoint")).toBe(true);
  });

  it("flags an exposed RPC key even with no wallet-adapter code", () => {
    write(".env", "NEXT_PUBLIC_RPC_URL=https://mainnet.helius-rpc.com/?api-key=abc123DEF456ghi\n");
    const r = analyzeWallet(dir);
    expect(r.walletAdapterDetected).toBe(false);
    expect(r.findings.some((f) => f.id === "solana-rpc-key-exposed")).toBe(true);
  });

  it("flags a wallet UI missing its stylesheet, and clears it once imported", () => {
    write(".env", "NEXT_PUBLIC_SOLANA_NETWORK=devnet\n");
    const base =
      'import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";\n' +
      ADAPTER_IMPORT +
      "const net = process.env.NEXT_PUBLIC_SOLANA_NETWORK;\nconst endpoint = clusterApiUrl(net);\n<WalletMultiButton />";
    write("App.tsx", base);
    expect(analyzeWallet(dir).findings.some((f) => f.id === "solana-wallet-ui-styles-missing")).toBe(true);

    write("App.tsx", "import '@solana/wallet-adapter-react-ui/styles.css';\n" + base);
    expect(analyzeWallet(dir).findings.some((f) => f.id === "solana-wallet-ui-styles-missing")).toBe(false);
  });

  it("returns allow with no wallet-adapter setup and no env keys", () => {
    write("index.ts", "export const x = 1;");
    expect(analyzeWallet(dir).verdict).toBe("allow");
  });
});

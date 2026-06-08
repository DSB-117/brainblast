import type { OnChainProgram, TrustGraph } from "./types.ts";

// Render a TrustGraph as Markdown for the Risk Report. Designed to be readable
// in raw form (it's what a human will skim in a PR review) AND to round-trip
// every field a downstream agent might want — every program is one
// self-contained block, no information is collapsed to "see appendix."

function renderAuthority(p: OnChainProgram): string {
  const a = p.upgradeAuthority;
  switch (a.kind) {
    case "renounced":
      return "🔒 **Renounced** — program is frozen; no key can upgrade it.";
    case "single-key":
      return `⚠️ **Single key** \`${a.address}\` — one private key can replace this program at any time.`;
    case "multisig":
      return `🔐 **Multisig** \`${a.address}\` — a threshold of signers can upgrade.`;
    case "dao":
      return `🏛 **DAO** \`${a.address}\` — governance program controls upgrades.`;
    case "unknown":
      return a.address
        ? `❓ **Unclassified authority** \`${a.address}\` — needs research to confirm single-key vs multisig/DAO.`
        : "❓ **Unknown** — could not determine upgrade authority.";
  }
}

function renderVerified(p: OnChainProgram): string {
  const v = p.verifiedBuild;
  switch (v.state) {
    case "verified":
      return `✅ Verified build${v.commit ? ` @ \`${v.commit.slice(0, 12)}\`` : ""} — [registry](${v.registryUrl})`;
    case "unverified":
      return "❌ Unverified — on-chain bytecode does not match any source we trust.";
    case "unknown":
      return "❓ Verified-build status not checked.";
  }
}

function renderAudits(p: OnChainProgram): string {
  if (!p.audits.length) return "_No audits on file._";
  return p.audits
    .map((a) => `- ${a.firm} (${a.date}) — [report](${a.reportUrl})${a.auditedCommit ? ` @ \`${a.auditedCommit.slice(0, 12)}\`` : ""}`)
    .join("\n");
}

function renderParity(p: OnChainProgram): string {
  const { mainnet, devnet, testnet, notes } = p.parity;
  const cells = [`mainnet=\`${mainnet}\``, `devnet=\`${devnet}\``];
  if (testnet) cells.push(`testnet=\`${testnet}\``);
  return cells.join(" · ") + (notes ? `  \n  _${notes}_` : "");
}

export function renderProgram(p: OnChainProgram): string {
  return [
    `### ${p.name}`,
    "",
    `\`${p.programId}\`${p.kind ? ` · kind: \`${p.kind}\`` : ""}`,
    "",
    `- **Upgrade authority:** ${renderAuthority(p)}`,
    `- **Verified build:** ${renderVerified(p)}`,
    `- **Parity:** ${renderParity(p)}`,
    `- **Audits:**\n${renderAudits(p).split("\n").map((l) => "  " + l).join("\n")}`,
    p.invokes && p.invokes.length ? `- **Invokes (CPI):** ${p.invokes.map((id) => `\`${id}\``).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderTrustGraphMd(g: TrustGraph): string {
  const head = [
    "# Trust Graph",
    "",
    `_Generated ${g.generatedAt}._`,
    "",
    "Every program your code transitively invokes, with the authority that controls it, the build-verification status, and the audits we found.",
    "",
  ].join("\n");
  const body = g.programs.map(renderProgram).join("\n\n---\n\n");
  const tail = g.unresolved.length
    ? [
        "",
        "---",
        "",
        "## Unresolved",
        "",
        ...g.unresolved.map((u) => `- \`${u.programId}\` — ${u.reason}`),
      ].join("\n")
    : "";
  return head + body + tail + "\n";
}

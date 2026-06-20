import type { OnChainProgram, TrustGraph } from "./types.ts";

// Render a TrustGraph as Markdown for the Risk Report. Designed to be readable
// in raw form (it's what a human will skim in a PR review) AND to round-trip
// every field a downstream agent might want — every program is one
// self-contained block, no information is collapsed to "see appendix."

function renderAuthority(p: OnChainProgram): string {
  const a = p.upgradeAuthority;
  const owner = a.ownerProgram ? ` _(owner: \`${a.ownerProgram}\`)_` : "";
  switch (a.kind) {
    case "renounced":
      return "🔒 **Renounced** — program is frozen; no key can upgrade it.";
    case "single-key":
      return `⚠️ **Single key** \`${a.address}\` — one private key can replace this program at any time.${owner}`;
    case "multisig":
      return `🔐 **Multisig** \`${a.address}\` — a threshold of signers can upgrade.${owner}`;
    case "dao":
      return `🏛 **DAO** \`${a.address}\` — governance program controls upgrades.${owner}`;
    case "unknown":
      return a.address
        ? `❓ **Unclassified authority** \`${a.address}\`${owner} — needs research to confirm single-key vs multisig/DAO.`
        : "❓ **Unknown** — could not determine upgrade authority.";
  }
}

// One-line, at-a-glance trust verdict combining the three questions a Solana
// dev answers by hand on Solscan: who can upgrade it, is the build verified,
// is it audited.
function renderTrustSummary(p: OnChainProgram): string {
  const a = p.upgradeAuthority;
  const authBit =
    a.kind === "renounced"
      ? "🔒 immutable"
      : a.kind === "multisig"
        ? "🔐 multisig"
        : a.kind === "dao"
          ? "🏛 DAO-governed"
          : a.kind === "single-key"
            ? "⚠️ single-key upgradeable"
            : "❓ authority unclassified";
  const verifiedBit =
    p.verifiedBuild.state === "verified"
      ? "✅ verified build"
      : p.verifiedBuild.state === "unverified"
        ? "❌ unverified"
        : "❓ build unchecked";
  const auditBit = p.audits.length
    ? `✅ audited (${p.audits.map((x) => x.firm).join(", ")})`
    : "❌ no audits on file";
  return `${authBit} · ${verifiedBit} · ${auditBit}`;
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
    `**Trust:** ${renderTrustSummary(p)}`,
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

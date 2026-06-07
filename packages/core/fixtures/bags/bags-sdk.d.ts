// Minimal ambient stand-in for the (as-yet-unpublished) Bags SDK, so the
// fixtures typecheck without the real package. Declares only the surface the
// fixtures use. The generated contract test vi.mock()s this module at runtime.
declare module "@bagsfm/bags-sdk" {
  export interface FeeClaimer {
    user: string;
    userBps: number;
  }
  export interface BagsFeeShareConfigInput {
    feeClaimers: FeeClaimer[];
  }
  export function createBagsFeeShareConfig(
    input: BagsFeeShareConfigInput,
  ): { meteoraConfigKey: string };
}

import { describe, expect, it } from "vitest";
import { ExactEvmScheme, UptoEvmScheme } from "@x402/evm";
import type { PaymentRequirements } from "../types";
import {
  createEvmClientScheme,
  formatRequirementBalance,
  getFormattedRequirementAmount,
} from "./utils";

const exactRequirement: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "1000000",
  payTo: "0x209693Bc6afc0C5328bA36FaF04C514EF312287C",
  maxTimeoutSeconds: 60,
};

const uptoRequirement: PaymentRequirements = {
  scheme: "upto",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "5000000",
  payTo: "0x209693Bc6afc0C5328bA36FaF04C514EF312287C",
  maxTimeoutSeconds: 300,
  extra: {
    assetTransferMethod: "permit2",
    facilitatorAddress: "0xFAC11174700123456789012345678901234aBCDe",
  },
};

const megaUsdRequirement: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:4326",
  asset: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  amount: "1000000000000000000",
  payTo: "0x209693Bc6afc0C5328bA36FaF04C514EF312287C",
  maxTimeoutSeconds: 60,
};

describe("evm paywall utils", () => {
  it("creates an exact scheme for exact requirements", () => {
    const signer = {
      address: "0x0000000000000000000000000000000000000001",
      signTypedData: async () => "0x1",
    };

    expect(createEvmClientScheme(signer, exactRequirement)).toBeInstanceOf(ExactEvmScheme);
  });

  it("creates an upto scheme for upto requirements", () => {
    const signer = {
      address: "0x0000000000000000000000000000000000000001",
      signTypedData: async () => "0x1",
    };

    expect(createEvmClientScheme(signer, uptoRequirement)).toBeInstanceOf(UptoEvmScheme);
  });

  it("formats 18-decimal default asset amounts correctly", () => {
    expect(getFormattedRequirementAmount(megaUsdRequirement)).toBe(1);
    expect(formatRequirementBalance(1500000000000000000n, megaUsdRequirement)).toBe("1.5");
  });

  it("matches registered assets case-insensitively when formatting", () => {
    const lowerCaseMegaUsdRequirement = {
      ...megaUsdRequirement,
      asset: megaUsdRequirement.asset.toLowerCase(),
    };

    expect(getFormattedRequirementAmount(lowerCaseMegaUsdRequirement)).toBe(1);
    expect(formatRequirementBalance(1500000000000000000n, lowerCaseMegaUsdRequirement)).toBe("1.5");
  });
});

import { ExactEvmScheme, UptoEvmScheme } from "@x402/evm";
import type { ClientEvmSigner } from "@x402/evm";
import {
  formatUnits,
  getAddress,
  type Account,
  type Address,
  type Chain,
  type Client,
  type Transport,
} from "viem";
import { getAssetInfo } from "../../../../mechanisms/evm/src/shared/defaultAssets";
import type { PaymentRequirements } from "../types";

/**
 * ERC20 balanceOf ABI
 */
const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

/**
 * Creates the EVM client scheme that matches the selected requirement.
 *
 * @returns The registered EVM client scheme implementation for the requirement.
 */
export function createEvmClientScheme(
  signer: ClientEvmSigner,
  requirement: PaymentRequirements,
): ExactEvmScheme | UptoEvmScheme {
  switch (requirement.scheme) {
    case "exact":
      return new ExactEvmScheme(signer);
    case "upto":
      return new UptoEvmScheme(signer);
    default:
      throw new Error(`Unsupported EVM payment scheme: ${requirement.scheme}`);
  }
}

/**
 * Formats the selected requirement amount using the registered asset decimals.
 *
 * @returns The human-readable token amount.
 */
export function getFormattedRequirementAmount(requirement: PaymentRequirements): number {
  const amount = requirement.amount ?? requirement.maxAmountRequired;
  if (!amount) {
    return 0;
  }

  return Number(
    formatUnits(BigInt(amount), getAssetInfo(requirement.network, requirement.asset).decimals),
  );
}

/**
 * Formats an ERC-20 balance for display.
 *
 * @returns The human-readable token balance.
 */
export function formatRequirementBalance(
  balance: bigint,
  requirement: PaymentRequirements,
): string {
  return formatUnits(balance, getAssetInfo(requirement.network, requirement.asset).decimals);
}

/**
 * Gets the configured ERC-20 balance for a specific address on the current chain.
 *
 * @param client - Viem client instance connected to the blockchain
 * @param requirement - Payment requirement containing the ERC-20 asset address
 * @param address - Address to check the token balance for
 * @returns ERC-20 balance as bigint (0 on read failure)
 */
export async function getErc20Balance<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account | undefined = undefined,
>(
  client: Client<TTransport, TChain, TAccount>,
  requirement: PaymentRequirements,
  address: Address,
): Promise<bigint> {
  try {
    const balance = await client.readContract({
      address: getAddress(requirement.asset),
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [address],
    });
    return balance as bigint;
  } catch (error) {
    console.error("Failed to fetch token balance:", error);
    return 0n;
  }
}

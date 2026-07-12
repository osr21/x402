import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createWalletClient, custom, type Hex, type WalletClient } from "viem";
import { baseSepolia } from "viem/chains";

type WalletContextValue = {
  isConnected: boolean;
  address: Hex | null;
  walletClient: WalletClient | null;
  error: string | null;
  isConnecting: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
};

type EthereumProvider = {
  request(args: {
    method: string;
    params?: unknown[] | Record<string, unknown>[];
  }): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const walletContext = createContext<WalletContextValue | undefined>(undefined);
const baseSepoliaChainIdHex = "0x14a34";

const buildClient = async (address: string): Promise<WalletClient> => {
  const provider = window.ethereum;
  if (!provider) {
    throw new Error("No injected Ethereum wallet found");
  }

  const chainId = (await provider.request({ method: "eth_chainId" })) as string;

  if (chainId !== baseSepoliaChainIdHex) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: baseSepoliaChainIdHex }],
      });
    } catch (switchError) {
      const error = switchError as { code?: number };
      if (error.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: baseSepoliaChainIdHex,
              chainName: "Base Sepolia",
              nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://sepolia.base.org"],
              blockExplorerUrls: ["https://sepolia.basescan.org"],
            },
          ],
        });
      } else {
        throw switchError;
      }
    }
  }

  return createWalletClient({
    account: address as Hex,
    chain: baseSepolia,
    transport: custom(provider),
  });
};

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<Hex | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const disconnectWallet = useCallback(() => {
    setWalletClient(null);
    setAddress(null);
    setIsConnected(false);
    setError(null);
  }, []);

  const checkConnection = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      return;
    }

    try {
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      if (accounts.length === 0) {
        return;
      }

      const client = await buildClient(accounts[0]);
      setWalletClient(client);
      setAddress(accounts[0] as Hex);
      setIsConnected(true);
      setError(null);
    } catch (nextError) {
      console.error("Failed to restore wallet connection", nextError);
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  const connectWallet = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      setError("Install an injected wallet such as MetaMask to continue.");
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts.length === 0) {
        throw new Error("No accounts were returned by the wallet.");
      }

      const client = await buildClient(accounts[0]);
      setWalletClient(client);
      setAddress(accounts[0] as Hex);
      setIsConnected(true);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : "Failed to connect the wallet.";
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) {
      return;
    }

    const handleAccountsChanged = async (...args: unknown[]) => {
      const [accounts] = args as [string[]];
      if (!accounts || accounts.length === 0) {
        disconnectWallet();
        return;
      }

      try {
        const client = await buildClient(accounts[0]);
        setWalletClient(client);
        setAddress(accounts[0] as Hex);
        setIsConnected(true);
        setError(null);
      } catch (nextError) {
        console.error("Failed to refresh wallet state after account change", nextError);
      }
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);

    return () => {
      provider.removeListener("accountsChanged", handleAccountsChanged);
      provider.removeListener("chainChanged", handleChainChanged);
    };
  }, [disconnectWallet]);

  const value = useMemo<WalletContextValue>(
    () => ({
      isConnected,
      address,
      walletClient,
      error,
      isConnecting,
      connectWallet,
      disconnectWallet,
    }),
    [address, connectWallet, disconnectWallet, error, isConnected, isConnecting, walletClient],
  );

  return <walletContext.Provider value={value}>{children}</walletContext.Provider>;
};

export const useWallet = () => {
  const context = useContext(walletContext);
  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return context;
};

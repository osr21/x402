import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
  import { createWalletClient, custom, type WalletClient } from 'viem';
  import { baseSepolia } from 'viem/chains';
  import type { Hex } from 'viem';

  interface WalletContextType {
    isConnected: boolean;
    address: Hex | null;
    walletClient: WalletClient | null;
    error: string | null;
    isConnecting: boolean;
    connectWallet: () => Promise<void>;
    disconnectWallet: () => void;
  }

  const WalletContext = createContext<WalletContextType | undefined>(undefined);

  const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14a34'; // 84532

  async function buildClient(address: string): Promise<WalletClient> {
    // Always switch to Base Sepolia before creating the client — covers both
    // the initial connect path and silent reconnects on page load.
    const chainId = await window.ethereum.request({ method: 'eth_chainId' }) as string;
    if (chainId !== BASE_SEPOLIA_CHAIN_ID_HEX) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
              chainName: 'Base Sepolia',
              nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://sepolia.base.org'],
              blockExplorerUrls: ['https://sepolia.basescan.org'],
            }],
          });
        } else {
          throw switchError;
        }
      }
    }
    return createWalletClient({ account: address as Hex, chain: baseSepolia, transport: custom(window.ethereum) });
  }

  export function WalletProvider({ children }: { children: React.ReactNode }) {
    const [isConnected, setIsConnected] = useState(false);
    const [address, setAddress] = useState<Hex | null>(null);
    const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);

    useEffect(() => { checkConnection(); }, []);

    // checkConnection now enforces the correct chain — a returning user on mainnet
    // gets switched to Base Sepolia rather than getting a mismatched-chainId payment failure.
    const checkConnection = async () => {
      if (typeof window.ethereum === 'undefined') return;
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }) as string[];
        if (accounts.length > 0) {
          const client = await buildClient(accounts[0]);
          setWalletClient(client);
          setAddress(accounts[0] as Hex);
          setIsConnected(true);
        }
      } catch (err) {
        console.error('Failed to check wallet connection:', err);
      }
    };

    const connectWallet = useCallback(async () => {
      setError(null);
      setIsConnecting(true);
      try {
        if (typeof window.ethereum === 'undefined') {
          throw new Error('Please install MetaMask or another Ethereum wallet');
        }
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
        if (accounts.length === 0) throw new Error('No accounts found');
        const client = await buildClient(accounts[0]);
        setWalletClient(client);
        setAddress(accounts[0] as Hex);
        setIsConnected(true);
      } catch (err: any) {
        setError(err.message || 'Failed to connect wallet');
      } finally {
        setIsConnecting(false);
      }
    }, []);

    const disconnectWallet = useCallback(() => {
      setWalletClient(null);
      setAddress(null);
      setIsConnected(false);
      setError(null);
    }, []);

    useEffect(() => {
      if (typeof window.ethereum === 'undefined') return;

      const handleAccountsChanged = async (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else if (accounts[0] !== address) {
          try {
            const client = await buildClient(accounts[0]);
            setWalletClient(client);
            setAddress(accounts[0] as Hex);
            setIsConnected(true);
          } catch (err) {
            console.error('Account change reconnect failed:', err);
          }
        }
      };

      // Reload on chain change so all state re-derives from the new network.
      const handleChainChanged = () => { window.location.reload(); };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      };
    }, [address, disconnectWallet]);

    return (
      <WalletContext.Provider value={{ isConnected, address, walletClient, error, isConnecting, connectWallet, disconnectWallet }}>
        {children}
      </WalletContext.Provider>
    );
  }

  export function useWallet() {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be used within a WalletProvider');
    return ctx;
  }
  
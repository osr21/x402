import { useCallback, useMemo, useState } from "react";
import { x402Client, x402HTTPClient, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import type { SettleResponse } from "@x402/core/types";
import type { WalletClient } from "viem";
import { useWallet } from "./contexts/WalletContext";

type SessionRecord = {
  id: string;
  type: "24hour" | "onetime";
  expiresAt?: string;
  validFor?: string;
};

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

const browserWalletToSigner = (walletClient: WalletClient) => {
  if (!walletClient.account) {
    throw new Error("Wallet client is missing an account");
  }

  return toClientEvmSigner({
    address: walletClient.account.address,
    signTypedData: async message =>
      walletClient.signTypedData({
        account: walletClient.account!,
        domain: message.domain,
        types: message.types,
        primaryType: message.primaryType,
        message: message.message,
      }),
  });
};

const createPaymentFetch = (walletClient: WalletClient) => {
  const paymentClient = new x402Client().register(
    "eip155:*",
    new ExactEvmScheme(browserWalletToSigner(walletClient)),
  );
  const httpClient = new x402HTTPClient(paymentClient);
  return {
    fetchWithPayment: wrapFetchWithPayment(fetch, httpClient),
    httpClient,
  };
};

export const App = () => {
  const {
    address,
    connectWallet,
    disconnectWallet,
    error,
    isConnected,
    isConnecting,
    walletClient,
  } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [lastSettlement, setLastSettlement] = useState<SettleResponse | null>(null);
  const [message, setMessage] = useState<string>("Connect a Base Sepolia wallet to start.");
  const [logLines, setLogLines] = useState<string[]>([]);

  const appendLog = useCallback((entry: string) => {
    setLogLines(lines => [entry, ...lines].slice(0, 8));
  }, []);

  const buyAccess = useCallback(
    async (endpoint: "/api/pay/session" | "/api/pay/onetime") => {
      if (!walletClient) {
        setMessage("Connect your wallet before trying to pay.");
        return;
      }

      setIsLoading(true);
      setMessage("");

      try {
        const { fetchWithPayment, httpClient } = createPaymentFetch(walletClient);
        const response = await fetchWithPayment(`${serverUrl}${endpoint}`, { method: "POST" });
        const payload = (await response.json()) as {
          message: string;
          session?: SessionRecord;
          access?: SessionRecord;
        };

        if (!response.ok) {
          throw new Error(
            payload.message || `Payment request failed with status ${response.status}`,
          );
        }

        const settlement = httpClient.getPaymentSettleResponse(name => response.headers.get(name));
        const session = payload.session ?? payload.access;
        if (!session) {
          throw new Error("The server did not return a session payload.");
        }

        setCurrentSession(session);
        setLastSettlement(settlement);
        setMessage(payload.message);
        appendLog(`Paid ${endpoint} and received ${session.type} session ${session.id}.`);
      } catch (nextError) {
        const nextMessage =
          nextError instanceof Error ? nextError.message : "Failed to complete payment.";
        setMessage(nextMessage);
        appendLog(`Payment flow failed: ${nextMessage}`);
      } finally {
        setIsLoading(false);
      }
    },
    [appendLog, walletClient],
  );

  const refreshSession = useCallback(async () => {
    if (!currentSession) {
      setMessage("Create a session first.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${serverUrl}/api/session/${currentSession.id}`);
      const payload = (await response.json()) as {
        valid: boolean;
        error?: string;
        session?: SessionRecord & { remainingTime: number };
      };

      if (!response.ok || !payload.valid || !payload.session) {
        throw new Error(payload.error || "Session is no longer valid.");
      }

      setCurrentSession(payload.session);
      setMessage(
        `${payload.session.type} session is valid. ${Math.ceil(payload.session.remainingTime / 1000)} seconds remain.`,
      );
      appendLog(`Refreshed session ${payload.session.id}.`);
    } catch (nextError) {
      const nextMessage =
        nextError instanceof Error ? nextError.message : "Failed to refresh the session.";
      setMessage(nextMessage);
      appendLog(`Session refresh failed: ${nextMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [appendLog, currentSession]);

  const consumeSession = useCallback(async () => {
    if (!currentSession) {
      setMessage("Create a session first.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${serverUrl}/api/session/${currentSession.id}/consume`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        success: boolean;
        error?: string;
        type?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to consume the session.");
      }

      setMessage(
        payload.type === "onetime"
          ? "One-time session consumed."
          : "24-hour session acknowledged without being invalidated.",
      );
      appendLog(`Consumed session ${currentSession.id}.`);
    } catch (nextError) {
      const nextMessage =
        nextError instanceof Error ? nextError.message : "Failed to consume the session.";
      setMessage(nextMessage);
      appendLog(`Session consume failed: ${nextMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [appendLog, currentSession]);

  const settlementSummary = useMemo(() => {
    if (!lastSettlement) {
      return "No payment settled yet.";
    }

    return `${lastSettlement.network} • ${lastSettlement.transaction}`;
  }, [lastSettlement]);

  return (
    <main className="layout">
      <section className="hero">
        <p className="eyebrow">x402 fullstack example</p>
        <h1>Browser wallet + paid session tokens</h1>
        <p className="lede">
          This example pays Base Sepolia x402 routes directly from an injected wallet, then uses the
          returned token against free session status and consume endpoints.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Wallet</h2>
          {isConnected ? (
            <button className="secondary" onClick={disconnectWallet}>
              Disconnect
            </button>
          ) : (
            <button
              className="primary"
              disabled={isConnecting}
              onClick={() => void connectWallet()}
            >
              {isConnecting ? "Connecting..." : "Connect wallet"}
            </button>
          )}
        </div>
        <p className="meta">
          {isConnected && address ? `Connected: ${address}` : "Base Sepolia wallet not connected"}
        </p>
        {error ? <p className="status error">{error}</p> : null}
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Buy access</h2>
            <span className="pill">Server: {serverUrl}</span>
          </div>
          <div className="actions">
            <button
              className="primary"
              disabled={!isConnected || isLoading}
              onClick={() => void buyAccess("/api/pay/session")}
            >
              Buy 24-hour access ($1.00)
            </button>
            <button
              className="secondary"
              disabled={!isConnected || isLoading}
              onClick={() => void buyAccess("/api/pay/onetime")}
            >
              Buy one-time access ($0.10)
            </button>
          </div>
          <p className="status">{message}</p>
          <p className="meta">Last settlement: {settlementSummary}</p>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Session token</h2>
            <span className="pill">{currentSession?.type ?? "none"}</span>
          </div>
          {currentSession ? (
            <>
              <p className="meta">Session ID: {currentSession.id}</p>
              <p className="meta">
                Expires: {currentSession.expiresAt ?? currentSession.validFor ?? "n/a"}
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={isLoading}
                  onClick={() => void refreshSession()}
                >
                  Check status
                </button>
                <button
                  className="primary"
                  disabled={isLoading}
                  onClick={() => void consumeSession()}
                >
                  Consume token
                </button>
              </div>
            </>
          ) : (
            <p className="meta">No session purchased yet.</p>
          )}
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recent events</h2>
        </div>
        <ul className="log">
          {logLines.length === 0 ? <li>No events recorded yet.</li> : null}
          {logLines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
};

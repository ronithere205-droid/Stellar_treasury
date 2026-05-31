"use client";
import { useState } from "react";
import { getFreighterPublicKey, fundWithFriendbot } from "../lib/stellar";

/**
 * Wallet connection component.
 *
 * PITFALL (Guide §4): The old code used `setAllowed()` from freighter-api,
 * which is deprecated. Modern Freighter API uses `requestAccess()` which
 * is already called inside getFreighterPublicKey(). Importing a nonexistent
 * `setAllowed` would crash at runtime.
 */
export default function WalletConnect({
  onConnect,
}: {
  onConnect: (pubKey: string) => void;
}) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundingSuccess, setFundingSuccess] = useState(false);

  const connectWallet = async () => {
    try {
      setLoading(true);
      setError(null);
      const key = await getFreighterPublicKey();
      setPublicKey(key);
      onConnect(key);
    } catch (err: any) {
      setError(err.message || "Failed to connect to Freighter");
    } finally {
      setLoading(false);
    }
  };

  const disconnectWallet = () => {
    setPublicKey(null);
    setError(null);
    setFundingSuccess(false);
    onConnect(""); // Signal parent that wallet is disconnected
  };

  const getTestnetXLM = async () => {
    if (!publicKey) return;
    try {
      setLoading(true);
      setError(null);
      setFundingSuccess(false);
      await fundWithFriendbot(publicKey);
      setFundingSuccess(true);
    } catch (err: any) {
      // Friendbot returns an error if the account is already funded
      if (err.message?.includes("createAccountAlreadyExist")) {
        setError("Account already funded. You already have Testnet XLM.");
      } else {
        setError(err.message || "Failed to fund");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 bg-gray-800 p-4 rounded-lg mb-8">
      {!publicKey ? (
        <button
          onClick={connectWallet}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded transition-colors"
        >
          {loading ? "Connecting..." : "Connect Wallet"}
        </button>
      ) : (
        <>
          <div className="text-white font-mono bg-gray-900 p-2 rounded text-sm">
            {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
          </div>
          <button
            onClick={getTestnetXLM}
            disabled={loading}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded transition-colors"
          >
            {loading ? "Funding..." : "Get Testnet XLM"}
          </button>
          <button
            onClick={disconnectWallet}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition-colors"
          >
            Disconnect
          </button>
        </>
      )}
      {fundingSuccess && (
        <div className="text-green-400 text-sm">✅ Funded successfully!</div>
      )}
      {error && <div className="text-red-400 text-sm break-all">{error}</div>}
    </div>
  );
}

"use client";
import { useState } from "react";
import WalletConnect from "../components/WalletConnect";
import MainFeature from "../components/MainFeature";

export default function Home() {
  const [publicKey, setPublicKey] = useState<string>("");

  const handleConnect = (key: string) => {
    setPublicKey(key);
  };

  return (
    <main className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-extrabold mb-8 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-green-400">
          Stellar Multi-Sig Treasury
        </h1>
        
        <WalletConnect onConnect={handleConnect} />
        
        {publicKey.length > 0 ? (
          <MainFeature publicKey={publicKey} />
        ) : (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-xl">Please connect your Freighter wallet to continue.</p>
            <p className="mt-2">Ensure you are connected to the Stellar Testnet.</p>
          </div>
        )}
      </div>
    </main>
  );
}

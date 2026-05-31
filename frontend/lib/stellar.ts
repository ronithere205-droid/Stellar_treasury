import {
  isConnected as freighterIsConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";

/**
 * Returns Stellar Testnet network configuration.
 * All values point to testnet — never mainnet.
 */
export function getNetworkConfig() {
  return {
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
    horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org",
    networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015",
  };
}

/**
 * Connects to Freighter and returns the user's public key.
 *
 * PITFALL (Guide §4): isConnected() returns { isConnected: boolean },
 * NOT a plain boolean. An object is always truthy in JS, so
 * `if (await isConnected())` would always be true even without Freighter.
 * We must destructure and check the `.isConnected` property.
 */
export async function getFreighterPublicKey(): Promise<string> {
  const connectionResult: any = await freighterIsConnected();
  const isConnected = typeof connectionResult === 'boolean' 
    ? connectionResult 
    : connectionResult?.isConnected;
    
  if (!isConnected) {
    throw new Error(
      "Freighter wallet is not installed or not connected. " +
      "Please install it from https://freighter.app and refresh."
    );
  }

  let address: string;
  try {
    const accessResult: any = await requestAccess();
    if (typeof accessResult === 'object' && accessResult !== null && accessResult.error) {
      throw new Error(accessResult.error);
    }
    address = typeof accessResult === 'string' ? accessResult : accessResult.address;
  } catch (err: any) {
    throw new Error(err.message || String(err));
  }
  
  if (!address) {
    throw new Error("Failed to get public key from Freighter");
  }
  return address;
}

/**
 * Signs a prepared transaction XDR with Freighter and submits
 * the raw signed XDR to the Soroban RPC.
 *
 * PITFALL (Guide §2): After Freighter signs, do NOT parse the returned
 * XDR back through TransactionBuilder.fromXDR() — it can crash with
 * "Bad union switch" due to protocol version mismatches between the
 * Freighter extension and your installed SDK version.
 *
 * SOLUTION: Send the raw base64 XDR string directly via JSON-RPC fetch.
 *
 * PITFALL (Guide §1): assembleTransaction() takes exactly 2 args
 * (tx, simulationResult), NOT 3. Passing networkPassphrase as arg 2
 * silently breaks it.  We avoid assembleTransaction entirely here
 * because the caller (contract.ts) already uses server.prepareTransaction()
 * which internally assembles + simulates.
 */
export async function signAndSubmitTransaction(xdr: string): Promise<string> {
  const { networkPassphrase, rpcUrl } = getNetworkConfig();

  let signResult: any;
  try {
    signResult = await signTransaction(xdr, {
      
      networkPassphrase,
    });
  } catch (err: any) {
    throw new Error(err.message || String(err));
  }

  if (typeof signResult === "object" && signResult !== null && signResult.error) {
    throw new Error(signResult.error);
  }

  // signResult is the signed XDR string (or an object with signedTxXdr)
  const signedXdr = typeof signResult === "string" ? signResult : signResult.signedTxXdr;

  // Send the raw signed XDR directly via JSON-RPC (Guide §2 — avoid fromXDR parsing)
  const sendResponse = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: { transaction: signedXdr },
    }),
  });
  const sendResult = await sendResponse.json();

  if (sendResult.error) {
    throw new Error(`RPC Error: ${sendResult.error.message || JSON.stringify(sendResult.error)}`);
  }

  return sendResult.result.hash;
}

/**
 * Fund a testnet account using Friendbot.
 */
export async function fundWithFriendbot(publicKey: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Friendbot failed: ${text}`);
  }
}

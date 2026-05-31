import {
  rpc,
  Address,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  Keypair,
  Account,
} from "@stellar/stellar-sdk";
import { getNetworkConfig, signAndSubmitTransaction, getFreighterPublicKey } from "./stellar";

/**
 * Returns the deployed contract ID from environment variables.
 */
export function getContractId(): string {
  const id = process.env.NEXT_PUBLIC_CONTRACT_ID || "";
  if (!id) {
    console.warn("NEXT_PUBLIC_CONTRACT_ID is not set. Contract calls will fail.");
  }
  return id;
}

/**
 * Get the Soroban RPC server instance.
 */
export function getServer(): rpc.Server {
  const { rpcUrl } = getNetworkConfig();
  return new rpc.Server(rpcUrl);
}

/**
 * Returns a configured Contract instance.
 */
export function getContract(): Contract {
  return new Contract(getContractId());
}

/**
 * Creates a TransactionBuilder for the given public key.
 */
async function getTransactionBuilder(
  publicKey: string,
  server: rpc.Server
): Promise<TransactionBuilder> {
  const { networkPassphrase } = getNetworkConfig();
  const account = await server.getAccount(publicKey);
  return new TransactionBuilder(account, {
    fee: "10000000", // 1 XLM max fee — generous for testnet
    networkPassphrase,
  });
}

/**
 * Helper to fetch the source account for building transactions.
 * For true submissions, we should fetch the actual account sequence from the network.
 * We generate a random keypair instead; simulation doesn't actually
 * submit so the account doesn't need to exist on-chain.
 */
async function getSimulationSourceAccount(server: rpc.Server) {
  const { networkPassphrase } = getNetworkConfig();
  // Use a fixed well-known testnet account or generate a random one.
  // For simulation, we can use any valid keypair — the simulation
  // doesn't check if the account exists.
  const randomKp = Keypair.random();
  // We need a real account for TransactionBuilder. Use a minimal account object.
  // rpc simulation doesn't validate the source account,
  // but TransactionBuilder requires a valid Account shape.
  const account = new Account(randomKp.publicKey(), "0");
  return { account, networkPassphrase };
}

/**
 * Build a read-only transaction for simulation.
 */
function buildSimulationTx(contract: Contract, fnName: string, ...args: any[]) {
  const { networkPassphrase } = getNetworkConfig();
  const randomKp = Keypair.random();
  // For simulation, we construct a minimal Account. The Soroban RPC
  // simulator doesn't actually validate the source account exists.
  return new TransactionBuilder(
    new (class {
      constructor(
        public accountId: () => string = () => randomKp.publicKey(),
        public sequenceNumber: () => string = () => "0",
        public sequence: string = "0"
      ) {}
      incrementSequenceNumber() {
        this.sequence = "1";
      }
    })() as any,
    { fee: "100", networkPassphrase }
  )
    .addOperation(contract.call(fnName, ...args))
    .setTimeout(30)
    .build();
}

// ─── Write Functions ───────────────────────────────────────────────

/**
 * Propose a new withdrawal from the treasury.
 */
export async function proposeWithdrawal(
  recipient: string,
  amount: string,
  reason: string
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const server = getServer();
  const publicKey = await getFreighterPublicKey();
  const contract = new Contract(getContractId());

  const txBuilder = await getTransactionBuilder(publicKey, server);

  const tx = txBuilder
    .addOperation(
      contract.call(
        "propose",
        new Address(publicKey).toScVal(),
        new Address(recipient).toScVal(),
        nativeToScVal(BigInt(amount), { type: "i128" }),
        nativeToScVal(reason, { type: "string" })
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  const xdrString = preparedTx.toXDR();
  const txHash = await signAndSubmitTransaction(xdrString);

  return await pollTransactionStatus(txHash);
}

/**
 * Approve a pending proposal.
 */
export async function approveProposal(
  proposalId: number
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const server = getServer();
  const publicKey = await getFreighterPublicKey();
  const contract = new Contract(getContractId());

  const txBuilder = await getTransactionBuilder(publicKey, server);

  const tx = txBuilder
    .addOperation(
      contract.call(
        "approve",
        new Address(publicKey).toScVal(),
        nativeToScVal(proposalId, { type: "u32" })
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  const xdrString = preparedTx.toXDR();
  const txHash = await signAndSubmitTransaction(xdrString);

  return await pollTransactionStatus(txHash);
}

/**
 * Buy the Submitter role by paying the submitter fee.
 */
export async function buySubmitterRole(): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const server = getServer();
  const publicKey = await getFreighterPublicKey();
  const contract = new Contract(getContractId());

  const txBuilder = await getTransactionBuilder(publicKey, server);

  const tx = txBuilder
    .addOperation(
      contract.call(
        "buy_submitter",
        new Address(publicKey).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  const xdrString = preparedTx.toXDR();
  const txHash = await signAndSubmitTransaction(xdrString);

  return await pollTransactionStatus(txHash);
}

/**
 * Buy the Authorizer (Signer) role by paying the authorizer fee.
 */
export async function buyAuthorizerRole(): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const server = getServer();
  const publicKey = await getFreighterPublicKey();
  const contract = new Contract(getContractId());

  const txBuilder = await getTransactionBuilder(publicKey, server);

  const tx = txBuilder
    .addOperation(
      contract.call(
        "buy_authorizer",
        new Address(publicKey).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  const xdrString = preparedTx.toXDR();
  const txHash = await signAndSubmitTransaction(xdrString);

  return await pollTransactionStatus(txHash);
}

// ─── Read Functions ────────────────────────────────────────────────

/**
 * Fetch a proposal by ID (read-only simulation).
 */
export async function getProposal(proposalId: number): Promise<any> {
  const server = getServer();
  const contract = new Contract(getContractId());

  const tx = buildSimulationTx(contract, "get_proposal", nativeToScVal(proposalId, { type: "u32" }));

  const response = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(response)) {
    throw new Error(`Simulation failed for get_proposal(${proposalId})`);
  }

  return scValToNative(response.result!.retval);
}

/**
 * Get the total number of proposals (read-only simulation).
 */
export async function getProposalCounter(): Promise<number> {
  const contractId = getContractId();
  if (!contractId) return 0;

  const server = getServer();
  const contract = new Contract(contractId);

  const tx = buildSimulationTx(contract, "get_proposal_counter");

  const response = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(response)) {
    return 0;
  }

  return scValToNative(response.result!.retval) as number;
}

/**
 * Get the list of authorized signers (read-only simulation).
 */
export async function getSigners(): Promise<string[]> {
  const server = getServer();
  const contract = new Contract(getContractId());

  const tx = buildSimulationTx(contract, "get_signers");

  const response = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(response)) {
    return [];
  }

  return scValToNative(response.result!.retval) as string[];
}

/**
 * Get the list of approvers for a proposal (read-only simulation).
 */
export async function getApprovals(proposalId: number): Promise<string[]> {
  const server = getServer();
  const contract = new Contract(getContractId());

  const tx = buildSimulationTx(
    contract,
    "get_approvals",
    nativeToScVal(proposalId, { type: "u32" })
  );

  const response = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(response)) {
    return [];
  }

  return scValToNative(response.result!.retval) as string[];
}

/**
 * Get the list of submitters (read-only simulation).
 */
export async function getSubmitters(): Promise<string[]> {
  const server = getServer();
  const contract = new Contract(getContractId());
  const tx = buildSimulationTx(contract, "get_submitters");
  const response = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(response)) {
    return [];
  }
  return scValToNative(response.result!.retval) as string[];
}

/**
 * Get the submitter fee (read-only simulation).
 */
export async function getSubmitterFee(): Promise<bigint> {
  const server = getServer();
  const contract = new Contract(getContractId());
  const tx = buildSimulationTx(contract, "get_submitter_fee");
  const response = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(response)) {
    return BigInt(0);
  }
  return BigInt(scValToNative(response.result!.retval));
}

/**
 * Get the authorizer fee (read-only simulation).
 */
export async function getAuthorizerFee(): Promise<bigint> {
  const server = getServer();
  const contract = new Contract(getContractId());
  const tx = buildSimulationTx(contract, "get_authorizer_fee");
  const response = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(response)) {
    return BigInt(0);
  }
  return BigInt(scValToNative(response.result!.retval));
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Poll getTransaction until it resolves or fails.
 * Includes a max-retry guard to prevent infinite loops.
 */
async function pollTransactionStatus(
  hash: string,
  maxRetries = 30
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const server = getServer();
  let retries = 0;

  while (retries < maxRetries) {
    const status = await server.getTransaction(hash);

    if (status.status === "SUCCESS") {
      return status as rpc.Api.GetSuccessfulTransactionResponse;
    }
    if (status.status === "FAILED") {
      throw new Error(
        `Transaction failed on-chain. Hash: ${hash}. Check Stellar Explorer for details.`
      );
    }
    // status.status === "NOT_FOUND" — keep polling
    retries++;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(
    `Transaction ${hash} did not resolve after ${maxRetries * 2}s. It may still be pending.`
  );
}

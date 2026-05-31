# Stellar Multi-Sig Treasury

A full-stack decentralized application built on the Stellar network using Soroban smart contracts. This project implements a Community Treasury with Multi-Sig Spending. It allows 3 pre-approved signers to control a shared XLM wallet. Any signer can propose a withdrawal by providing a recipient address, an amount in stroops, and a reason. The withdrawal is only executed on the blockchain when 2 out of the 3 signers have approved it, ensuring decentralized consensus over the treasury funds.

## Tech Stack
- Rust / Soroban SDK (Smart Contract)
- Next.js 14 App Router (Frontend)
- TypeScript
- Tailwind CSS (Styling)
- Stellar SDK (`@stellar/stellar-sdk`)
- Freighter (`@stellar/freighter-api`)

## Prerequisites
- Rust installed: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Wasm target: `rustup target add wasm32-unknown-unknown`
- Stellar CLI: `cargo install --locked stellar-cli --features opt`
- Node.js 18+
- Freighter wallet browser extension installed from [https://freighter.app](https://freighter.app)

## Project Structure
- `/contracts/src/lib.rs` - The Soroban smart contract written in Rust.
- `/contracts/Cargo.toml` - Rust project configuration and dependencies.
- `/frontend/app/page.tsx` - Main frontend landing page.
- `/frontend/app/layout.tsx` - Next.js root layout with font and CSS imports.
- `/frontend/components/WalletConnect.tsx` - Component to connect Freighter wallet and fund via Friendbot.
- `/frontend/components/MainFeature.tsx` - Component displaying proposals and interacting with the contract.
- `/frontend/lib/stellar.ts` - Setup for Freighter API and Stellar network config.
- `/frontend/lib/contract.ts` - Soroban SDK integration for calling contract functions.

## Step 1 — Build the Smart Contract
```bash
cd contracts
stellar contract build --optimize
```
This command compiles the Rust smart contract into a WebAssembly (.wasm) file optimized for the Soroban environment. The output file will be located at `target/wasm32v1-none/release/treasury_contract.wasm`.

## Step 2 — Set Up a Testnet Identity
```bash
stellar keys generate my-key --network testnet --fund
stellar keys address my-key
```
This creates a new Stellar keypair named `my-key` and automatically funds it with 10,000 Testnet XLM using Friendbot. This keypair will be used as the administrator to deploy the contract.

## Step 3 — Deploy Contract to Testnet
```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/treasury_contract.wasm \
  --source my-key \
  --network testnet
```
This deploys the WebAssembly contract to the Stellar Testnet. Once successful, it will return a Contract ID (starting with "C"). Copy the returned Contract ID — you will need it in Step 5.

*Note: After deploying, you must initialize the contract. You can do this via the CLI or use it directly if you add an initialization script. The required command to init the contract with the native XLM token and 3 signer addresses is:*
```bash
stellar contract invoke \
  --id <YOUR_CONTRACT_ID> \
  --source my-key \
  --network testnet \
  -- \
  init \
  --token_address CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --signers '["G...", "G...", "G..."]'
```

## Step 4 — Install Frontend Dependencies
```bash
cd ../frontend
npm install
```

## Step 5 — Configure Environment Variables
```bash
cp ../.env.example .env.local
```
Open `.env.local` and paste the Contract ID from Step 3 into `NEXT_PUBLIC_CONTRACT_ID`.

## Step 6 — Run the Frontend
```bash
npm run dev
```
Open http://localhost:3000 in your browser.

## Step 7 — Using the App
- Install Freighter at https://freighter.app and set it to Testnet mode (Settings → Network → Testnet)
- Click "Connect Wallet" to link your Freighter wallet
- Click "Get Testnet XLM" to fund your wallet via Friendbot if needed
- Add some native XLM to the contract address so the treasury has funds to distribute.
- If your connected wallet is one of the 3 signers initialized on the contract:
  - Submit a new proposal by filling in the recipient address, amount (in stroops), and reason.
  - Approve pending proposals.
- Wait for a transaction to complete; if a proposal reaches 2 approvals, it will be executed automatically, and the funds will be transferred to the recipient.

## Smart Contract Functions

- `init(env: Env, token_address: Address, signers: Vec<Address>)`
  **Write Function.** Initializes the contract with the native XLM address and exactly 3 signers. Can only be called once.

- `propose(env: Env, proposer: Address, recipient: Address, amount: i128, reason: String) -> u32`
  **Write Function.** Creates a new withdrawal proposal. Requires authorization from `proposer`. The proposer must be one of the initialized signers. Automatically adds 1 approval from the proposer. Returns the proposal ID.

- `approve(env: Env, approver: Address, proposal_id: u32)`
  **Write Function.** Approves a pending proposal. Requires authorization from `approver`, who must be a valid signer. If the proposal reaches 2 approvals, it executes the token transfer to the recipient.

- `get_proposal(env: Env, proposal_id: u32) -> Proposal`
  **Read Function.** Returns the details of a given proposal ID, including its execution status.

- `get_approvals(env: Env, proposal_id: u32) -> Vec<Address>`
  **Read Function.** Returns a list of addresses that have approved the given proposal.

- `get_proposal_counter(env: Env) -> u32`
  **Read Function.** Returns the total number of proposals created.

- `get_signers(env: Env) -> Vec<Address>`
  **Read Function.** Returns the 3 signer addresses authorized for this treasury.

## Common Errors & Fixes
- **"Transaction simulation failed"** → contract not deployed, wrong `CONTRACT_ID` in `.env.local`, or the contract has not been initialized with signers yet.
- **"Freighter not found"** → install the Freighter extension and refresh the page.
- **"Account not found"** → click "Get Testnet XLM" to fund your wallet first via Friendbot.
- **"wasm32 target not found"** → run: `rustup target add wasm32-unknown-unknown`

## Testnet Resources
- Stellar Testnet Explorer: https://stellar.expert/explorer/testnet
- Stellar Lab (manual transactions): https://lab.stellar.org
- Friendbot: https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY

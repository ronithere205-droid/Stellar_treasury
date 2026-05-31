import { rpc, Keypair, TransactionBuilder, Networks, Contract, Address, nativeToScVal } from '@stellar/stellar-sdk';

const server = new rpc.Server('https://soroban-testnet.stellar.org');
const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID; 

async function run() {
  const kp = Keypair.random();
  console.log("Funding account...", kp.publicKey());
  await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  
  const contract = new Contract('CBDUQI33IE4VSP75NRYPI33A64O6WOXRM3K2AAQHDBRVDFEKMMI6I7VC');
  
  const account = await server.getAccount(kp.publicKey());
  const txBuilder = new TransactionBuilder(account, { fee: '10000', networkPassphrase: Networks.TESTNET });
  
  const tx = txBuilder.addOperation(
    contract.call("buy_authorizer", new Address(kp.publicKey()).toScVal())
  ).setTimeout(30).build();
  
  console.log("Preparing...");
  const preparedTx = await server.prepareTransaction(tx);
  console.log("Simulation result:", JSON.stringify(preparedTx, null, 2));
}

run().catch(console.error);

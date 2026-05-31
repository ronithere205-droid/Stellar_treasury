#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, String, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Signers,
    Submitters,
    SubmitterFee,
    AuthorizerFee,
    TokenAddress,
    ProposalCounter,
    Proposal(u32),
    Approvals(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u32,
    pub proposer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub reason: String,
    pub executed: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidSignersCount = 3,
    NotASigner = 4,
    ProposalNotFound = 5,
    ProposalAlreadyExecuted = 6,
    AlreadyApproved = 7,
    InsufficientFunds = 8,
    NotAuthorizedToPropose = 9,
    AlreadyHasRole = 10,
}

#[contract]
pub struct TreasuryContract;

#[contractimpl]
impl TreasuryContract {
    /// Initialize the contract with a native token address, exactly 3 signers, and fees
    pub fn init(
        env: Env,
        token_address: Address,
        signers: Vec<Address>,
        submitter_fee: i128,
        authorizer_fee: i128,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Signers) {
            return Err(Error::AlreadyInitialized);
        }
        if signers.len() != 3 {
            return Err(Error::InvalidSignersCount);
        }
        env.storage().instance().set(&DataKey::Signers, &signers);
        
        let submitters = Vec::<Address>::new(&env);
        env.storage().instance().set(&DataKey::Submitters, &submitters);
        
        env.storage().instance().set(&DataKey::TokenAddress, &token_address);
        env.storage().instance().set(&DataKey::SubmitterFee, &submitter_fee);
        env.storage().instance().set(&DataKey::AuthorizerFee, &authorizer_fee);
        env.storage().instance().set(&DataKey::ProposalCounter, &0u32);
        Ok(())
    }

    /// Buy the Submitter role
    pub fn buy_submitter(env: Env, buyer: Address) -> Result<(), Error> {
        buyer.require_auth();

        let mut submitters: Vec<Address> = env.storage().instance().get(&DataKey::Submitters).ok_or(Error::NotInitialized)?;
        let signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).ok_or(Error::NotInitialized)?;
        
        if submitters.contains(&buyer) || signers.contains(&buyer) {
            return Err(Error::AlreadyHasRole);
        }

        let fee: i128 = env.storage().instance().get(&DataKey::SubmitterFee).unwrap();
        let token_address: Address = env.storage().instance().get(&DataKey::TokenAddress).unwrap();
        let token = token::Client::new(&env, &token_address);
        
        token.transfer(&buyer, &env.current_contract_address(), &fee);
        
        submitters.push_back(buyer);
        env.storage().instance().set(&DataKey::Submitters, &submitters);
        Ok(())
    }

    /// Buy the Authorizer (Signer) role
    pub fn buy_authorizer(env: Env, buyer: Address) -> Result<(), Error> {
        buyer.require_auth();

        let mut signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).ok_or(Error::NotInitialized)?;
        if signers.contains(&buyer) {
            return Err(Error::AlreadyHasRole);
        }

        let fee: i128 = env.storage().instance().get(&DataKey::AuthorizerFee).unwrap();
        let token_address: Address = env.storage().instance().get(&DataKey::TokenAddress).unwrap();
        let token = token::Client::new(&env, &token_address);
        
        token.transfer(&buyer, &env.current_contract_address(), &fee);
        
        signers.push_back(buyer);
        env.storage().instance().set(&DataKey::Signers, &signers);
        Ok(())
    }

    /// Propose a new withdrawal
    pub fn propose(
        env: Env,
        proposer: Address,
        recipient: Address,
        amount: i128,
        reason: String,
    ) -> Result<u32, Error> {
        proposer.require_auth();
        Self::check_submitter_or_signer(&env, &proposer)?;

        let mut counter: u32 = env.storage().instance().get(&DataKey::ProposalCounter).unwrap_or(0);
        counter += 1;

        let proposal = Proposal {
            id: counter,
            proposer: proposer.clone(),
            recipient,
            amount,
            reason,
            executed: false,
        };

        env.storage().persistent().set(&DataKey::Proposal(counter), &proposal);
        env.storage().instance().set(&DataKey::ProposalCounter, &counter);

        let mut approvals = Vec::new(&env);
        // Automatically add approval if proposer is a signer
        if Self::check_signer(&env, &proposer).is_ok() {
            approvals.push_back(proposer);
        }
        env.storage().persistent().set(&DataKey::Approvals(counter), &approvals);

        Ok(counter)
    }

    /// Approve a pending proposal. Executes automatically when reaching dynamic threshold.
    pub fn approve(env: Env, approver: Address, proposal_id: u32) -> Result<(), Error> {
        approver.require_auth();
        Self::check_signer(&env, &approver)?;

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }

        let mut approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));

        if approvals.contains(&approver) {
            return Err(Error::AlreadyApproved);
        }

        approvals.push_back(approver.clone());
        env.storage().persistent().set(&DataKey::Approvals(proposal_id), &approvals);

        let signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).unwrap();
        // Dynamic threshold: > 50%
        let required_approvals = (signers.len() / 2) + 1;

        if approvals.len() >= required_approvals {
            proposal.executed = true;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

            let token_address: Address = env.storage().instance().get(&DataKey::TokenAddress).unwrap();
            let token = token::Client::new(&env, &token_address);
            
            let contract_address = env.current_contract_address();
            if token.balance(&contract_address) < proposal.amount {
                // Revert transaction if treasury empty
                return Err(Error::InsufficientFunds);
            }

            token.transfer(&contract_address, &proposal.recipient, &proposal.amount);
        }

        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u32) -> Result<Proposal, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)
    }

    pub fn get_approvals(env: Env, proposal_id: u32) -> Result<Vec<Address>, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Approvals(proposal_id))
            .ok_or(Error::ProposalNotFound)
    }

    pub fn get_proposal_counter(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::ProposalCounter).unwrap_or(0)
    }

    pub fn get_signers(env: Env) -> Result<Vec<Address>, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Signers)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_submitters(env: Env) -> Result<Vec<Address>, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Submitters)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_submitter_fee(env: Env) -> Result<i128, Error> {
        env.storage()
            .instance()
            .get(&DataKey::SubmitterFee)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_authorizer_fee(env: Env) -> Result<i128, Error> {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizerFee)
            .ok_or(Error::NotInitialized)
    }

    fn check_signer(env: &Env, account: &Address) -> Result<(), Error> {
        let signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).ok_or(Error::NotInitialized)?;
        if !signers.contains(account) {
            return Err(Error::NotASigner);
        }
        Ok(())
    }

    fn check_submitter_or_signer(env: &Env, account: &Address) -> Result<(), Error> {
        let signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).ok_or(Error::NotInitialized)?;
        let submitters: Vec<Address> = env.storage().instance().get(&DataKey::Submitters).ok_or(Error::NotInitialized)?;
        
        if signers.contains(account) || submitters.contains(account) {
            Ok(())
        } else {
            Err(Error::NotAuthorizedToPropose)
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{token, IntoVal};

    #[test]
    fn test_init_and_propose() {
        let env = Env::default();
        let contract_id = env.register_contract(None, TreasuryContract);
        let client = TreasuryContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = sac.address();

        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        
        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone(), signer3.clone()]);
        client.init(&token_id, &signers, &100, &1000);

        assert_eq!(client.get_signers(), signers);
        assert_eq!(client.get_submitters().len(), 0);
        assert_eq!(client.get_submitter_fee(), 100);
        assert_eq!(client.get_authorizer_fee(), 1000);
        assert_eq!(client.get_proposal_counter(), 0);

        let recipient = Address::generate(&env);
        
        client
            .mock_auths(&[MockAuth {
                address: &signer1,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "propose",
                    args: (&signer1, &recipient, 1000i128, String::from_str(&env, "Payment")).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .propose(&signer1, &recipient, &1000, &String::from_str(&env, "Payment"));

        assert_eq!(client.get_proposal_counter(), 1);
        let proposal = client.get_proposal(&1);
        assert_eq!(proposal.executed, false);
        assert_eq!(proposal.amount, 1000);
    }

    #[test]
    fn test_execute_on_second_approval() {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, TreasuryContract);
        let client = TreasuryContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = sac.address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        
        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone(), signer3.clone()]);
        client.init(&token_id, &signers, &100, &1000);

        token_admin_client.mint(&contract_id, &5000);

        let recipient = Address::generate(&env);
        client.propose(&signer1, &recipient, &1000, &String::from_str(&env, "Payment"));
        
        // Approve by signer 2
        client.approve(&signer2, &1);
        
        let proposal = client.get_proposal(&1);
        assert_eq!(proposal.executed, true);
        assert_eq!(token_client.balance(&recipient), 1000);
        assert_eq!(token_client.balance(&contract_id), 4000);
    }

    #[test]
    fn test_buy_roles() {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, TreasuryContract);
        let client = TreasuryContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = sac.address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        
        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone(), signer3.clone()]);
        client.init(&token_id, &signers, &100, &1000);

        let new_user = Address::generate(&env);
        token_admin_client.mint(&new_user, &2000); // Give user enough for both

        // Test buy submitter
        client.buy_submitter(&new_user);
        assert_eq!(token_client.balance(&new_user), 1900);
        assert_eq!(token_client.balance(&contract_id), 100);
        assert!(client.get_submitters().contains(&new_user));

        // As a submitter, they can propose
        let recipient = Address::generate(&env);
        client.propose(&new_user, &recipient, &50, &String::from_str(&env, "Test"));
        
        let approvals = client.get_approvals(&1);
        // Since they aren't a signer, their proposal shouldn't get an automatic approval
        assert_eq!(approvals.len(), 0);

        // Test buy authorizer
        client.buy_authorizer(&new_user);
        assert_eq!(token_client.balance(&new_user), 900); // 1900 - 1000
        assert_eq!(token_client.balance(&contract_id), 1100);
        assert!(client.get_signers().contains(&new_user));

        // As an authorizer, they can approve
        client.approve(&new_user, &1);
        let approvals2 = client.get_approvals(&1);
        assert_eq!(approvals2.len(), 1);
        assert!(approvals2.contains(&new_user));
    }
}

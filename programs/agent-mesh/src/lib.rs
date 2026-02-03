use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("AgentMesh111111111111111111111111111111111");

#[program]
pub mod agent_mesh {
    use super::*;

    /// Register a new agent identity on-chain
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        agent_wallet: Pubkey,
        model_profile: Pubkey,
        metadata_uri: String,
        permissions: u64,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        let clock = Clock::get()?;

        agent.owner_wallet = ctx.accounts.owner.key();
        agent.agent_wallet = agent_wallet;
        agent.model_profile = model_profile;
        agent.metadata_uri = metadata_uri;
        agent.permissions = permissions;
        agent.created_at = clock.unix_timestamp;
        agent.updated_at = clock.unix_timestamp;
        agent.bump = ctx.bumps.agent;

        emit!(AgentRegistered {
            agent: agent.key(),
            owner: agent.owner_wallet,
            agent_wallet: agent.agent_wallet,
        });

        Ok(())
    }

    /// Update an existing agent's configuration
    pub fn update_agent(
        ctx: Context<UpdateAgent>,
        agent_wallet: Option<Pubkey>,
        model_profile: Option<Pubkey>,
        metadata_uri: Option<String>,
        permissions: Option<u64>,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        let clock = Clock::get()?;

        if let Some(wallet) = agent_wallet {
            agent.agent_wallet = wallet;
        }
        if let Some(profile) = model_profile {
            agent.model_profile = profile;
        }
        if let Some(uri) = metadata_uri {
            agent.metadata_uri = uri;
        }
        if let Some(perms) = permissions {
            agent.permissions = perms;
        }

        agent.updated_at = clock.unix_timestamp;

        emit!(AgentUpdated {
            agent: agent.key(),
            updated_at: agent.updated_at,
        });

        Ok(())
    }

    /// Create a new model profile for LLM configuration
    pub fn create_model_profile(
        ctx: Context<CreateModelProfile>,
        profile_id: [u8; 16],
        label: String,
        provider_uri: String,
        pricing: u64,
        billing_wallet: Pubkey,
        max_tokens_per_day: u64,
        max_requests_per_min: u64,
    ) -> Result<()> {
        let profile = &mut ctx.accounts.model_profile;
        let clock = Clock::get()?;

        profile.owner_wallet = ctx.accounts.owner.key();
        profile.profile_id = profile_id;
        profile.label = label;
        profile.provider_uri = provider_uri;
        profile.pricing = pricing;
        profile.billing_wallet = billing_wallet;
        profile.max_tokens_per_day = max_tokens_per_day;
        profile.max_requests_per_min = max_requests_per_min;
        profile.created_at = clock.unix_timestamp;
        profile.updated_at = clock.unix_timestamp;
        profile.bump = ctx.bumps.model_profile;

        emit!(ModelProfileCreated {
            profile: profile.key(),
            owner: profile.owner_wallet,
            label: profile.label.clone(),
        });

        Ok(())
    }

    /// Update a model profile
    pub fn update_model_profile(
        ctx: Context<UpdateModelProfile>,
        label: Option<String>,
        provider_uri: Option<String>,
        pricing: Option<u64>,
        billing_wallet: Option<Pubkey>,
        max_tokens_per_day: Option<u64>,
        max_requests_per_min: Option<u64>,
    ) -> Result<()> {
        let profile = &mut ctx.accounts.model_profile;
        let clock = Clock::get()?;

        if let Some(l) = label {
            profile.label = l;
        }
        if let Some(uri) = provider_uri {
            profile.provider_uri = uri;
        }
        if let Some(p) = pricing {
            profile.pricing = p;
        }
        if let Some(wallet) = billing_wallet {
            profile.billing_wallet = wallet;
        }
        if let Some(tokens) = max_tokens_per_day {
            profile.max_tokens_per_day = tokens;
        }
        if let Some(requests) = max_requests_per_min {
            profile.max_requests_per_min = requests;
        }

        profile.updated_at = clock.unix_timestamp;

        emit!(ModelProfileUpdated {
            profile: profile.key(),
            updated_at: profile.updated_at,
        });

        Ok(())
    }

    /// Create an intent from one agent to another
    pub fn create_intent(
        ctx: Context<CreateIntent>,
        nonce: u64,
        payload_hash: [u8; 32],
        payload_uri: String,
        payment_amount: u64,
    ) -> Result<()> {
        let intent = &mut ctx.accounts.intent;
        let clock = Clock::get()?;

        // Verify from_agent has CAN_CREATE_INTENT permission
        require!(
            ctx.accounts.from_agent.permissions & Permission::CAN_CREATE_INTENT != 0,
            ErrorCode::InsufficientPermissions
        );

        intent.from_agent = ctx.accounts.from_agent.key();
        intent.to_agent = ctx.accounts.to_agent.key();
        intent.nonce = nonce;
        intent.status = IntentStatus::Pending as u8;
        intent.payload_hash = payload_hash;
        intent.payload_uri = payload_uri;
        intent.payment_amount = payment_amount;
        intent.payment_mint = ctx.accounts.payment_mint.key();
        intent.result_hash = [0u8; 32];
        intent.result_uri = String::new();
        intent.created_at = clock.unix_timestamp;
        intent.updated_at = clock.unix_timestamp;
        intent.bump = ctx.bumps.intent;

        // Transfer payment to escrow if amount > 0
        if payment_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.from_token_account.to_account_info(),
                to: ctx.accounts.escrow_token_account.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            token::transfer(cpi_ctx, payment_amount)?;
        }

        emit!(IntentCreated {
            intent: intent.key(),
            from_agent: intent.from_agent,
            to_agent: intent.to_agent,
            payment_amount,
        });

        Ok(())
    }

    /// Update intent status (called by to_agent's owner)
    pub fn update_intent_status(
        ctx: Context<UpdateIntentStatus>,
        new_status: u8,
        result_hash: Option<[u8; 32]>,
        result_uri: Option<String>,
    ) -> Result<()> {
        let intent = &mut ctx.accounts.intent;
        let clock = Clock::get()?;

        // Verify to_agent has CAN_ACCEPT_INTENT permission
        require!(
            ctx.accounts.to_agent.permissions & Permission::CAN_ACCEPT_INTENT != 0,
            ErrorCode::InsufficientPermissions
        );

        intent.status = new_status;
        if let Some(hash) = result_hash {
            intent.result_hash = hash;
        }
        if let Some(uri) = result_uri {
            intent.result_uri = uri;
        }
        intent.updated_at = clock.unix_timestamp;

        // Release escrow if completed and payment exists
        if new_status == IntentStatus::Completed as u8 && intent.payment_amount > 0 {
            let seeds = &[
                b"intent",
                intent.from_agent.as_ref(),
                intent.to_agent.as_ref(),
                &intent.nonce.to_le_bytes(),
                &[intent.bump],
            ];
            let signer = &[&seeds[..]];

            let cpi_accounts = Transfer {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.billing_token_account.to_account_info(),
                authority: intent.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, intent.payment_amount)?;
        }

        emit!(IntentStatusUpdated {
            intent: intent.key(),
            status: new_status,
        });

        Ok(())
    }
}

// === Permission Flags ===
pub struct Permission;
impl Permission {
    pub const CAN_SWAP: u64 = 1 << 0;
    pub const CAN_TRANSFER: u64 = 1 << 1;
    pub const CAN_VOTE: u64 = 1 << 2;
    pub const CAN_CREATE_INTENT: u64 = 1 << 3;
    pub const CAN_ACCEPT_INTENT: u64 = 1 << 4;
}

// === Intent Status ===
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IntentStatus {
    Pending = 0,
    Accepted = 1,
    Completed = 2,
    Failed = 3,
}

// === Account Structures ===

#[account]
#[derive(Default)]
pub struct AgentIdentity {
    pub owner_wallet: Pubkey,      // 32
    pub agent_wallet: Pubkey,      // 32
    pub model_profile: Pubkey,     // 32
    pub metadata_uri: String,      // 4 + 200
    pub permissions: u64,          // 8
    pub created_at: i64,           // 8
    pub updated_at: i64,           // 8
    pub bump: u8,                  // 1
}

impl AgentIdentity {
    pub const MAX_SIZE: usize = 32 + 32 + 32 + (4 + 200) + 8 + 8 + 8 + 1;
}

#[account]
#[derive(Default)]
pub struct ModelProfile {
    pub owner_wallet: Pubkey,         // 32
    pub profile_id: [u8; 16],         // 16
    pub label: String,                // 4 + 64
    pub provider_uri: String,         // 4 + 200
    pub pricing: u64,                 // 8 (micro-units per 1K tokens)
    pub billing_wallet: Pubkey,       // 32
    pub max_tokens_per_day: u64,      // 8
    pub max_requests_per_min: u64,    // 8
    pub created_at: i64,              // 8
    pub updated_at: i64,              // 8
    pub bump: u8,                     // 1
}

impl ModelProfile {
    pub const MAX_SIZE: usize = 32 + 16 + (4 + 64) + (4 + 200) + 8 + 32 + 8 + 8 + 8 + 8 + 1;
}

#[account]
#[derive(Default)]
pub struct AgentIntent {
    pub from_agent: Pubkey,        // 32
    pub to_agent: Pubkey,          // 32
    pub nonce: u64,                // 8
    pub status: u8,                // 1
    pub payload_hash: [u8; 32],    // 32
    pub payload_uri: String,       // 4 + 200
    pub payment_amount: u64,       // 8
    pub payment_mint: Pubkey,      // 32
    pub result_hash: [u8; 32],     // 32
    pub result_uri: String,        // 4 + 200
    pub created_at: i64,           // 8
    pub updated_at: i64,           // 8
    pub bump: u8,                  // 1
}

impl AgentIntent {
    pub const MAX_SIZE: usize = 32 + 32 + 8 + 1 + 32 + (4 + 200) + 8 + 32 + 32 + (4 + 200) + 8 + 8 + 1;
}

// === Contexts ===

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + AgentIdentity::MAX_SIZE,
        seeds = [b"agent", owner.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, AgentIdentity>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner_wallet @ ErrorCode::Unauthorized
    )]
    pub agent: Account<'info, AgentIdentity>,

    #[account(constraint = owner.key() == agent.owner_wallet @ ErrorCode::Unauthorized)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(profile_id: [u8; 16])]
pub struct CreateModelProfile<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + ModelProfile::MAX_SIZE,
        seeds = [b"model_profile", owner.key().as_ref(), &profile_id],
        bump
    )]
    pub model_profile: Account<'info, ModelProfile>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateModelProfile<'info> {
    #[account(
        mut,
        has_one = owner_wallet @ ErrorCode::Unauthorized
    )]
    pub model_profile: Account<'info, ModelProfile>,

    #[account(constraint = owner.key() == model_profile.owner_wallet @ ErrorCode::Unauthorized)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateIntent<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + AgentIntent::MAX_SIZE,
        seeds = [b"intent", from_agent.key().as_ref(), to_agent.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub intent: Account<'info, AgentIntent>,

    #[account(
        seeds = [b"agent", from_agent.owner_wallet.as_ref()],
        bump = from_agent.bump
    )]
    pub from_agent: Account<'info, AgentIdentity>,

    #[account(
        seeds = [b"agent", to_agent.owner_wallet.as_ref()],
        bump = to_agent.bump
    )]
    pub to_agent: Account<'info, AgentIdentity>,

    /// CHECK: Payment mint for the intent
    pub payment_mint: AccountInfo<'info>,

    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateIntentStatus<'info> {
    #[account(mut)]
    pub intent: Account<'info, AgentIntent>,

    #[account(
        seeds = [b"agent", to_agent.owner_wallet.as_ref()],
        bump = to_agent.bump,
        constraint = intent.to_agent == to_agent.key() @ ErrorCode::Unauthorized
    )]
    pub to_agent: Account<'info, AgentIdentity>,

    #[account(constraint = owner.key() == to_agent.owner_wallet @ ErrorCode::Unauthorized)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub escrow_token_account: Option<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub billing_token_account: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

// === Events ===

#[event]
pub struct AgentRegistered {
    pub agent: Pubkey,
    pub owner: Pubkey,
    pub agent_wallet: Pubkey,
}

#[event]
pub struct AgentUpdated {
    pub agent: Pubkey,
    pub updated_at: i64,
}

#[event]
pub struct ModelProfileCreated {
    pub profile: Pubkey,
    pub owner: Pubkey,
    pub label: String,
}

#[event]
pub struct ModelProfileUpdated {
    pub profile: Pubkey,
    pub updated_at: i64,
}

#[event]
pub struct IntentCreated {
    pub intent: Pubkey,
    pub from_agent: Pubkey,
    pub to_agent: Pubkey,
    pub payment_amount: u64,
}

#[event]
pub struct IntentStatusUpdated {
    pub intent: Pubkey,
    pub status: u8,
}

// === Errors ===

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient permissions for this action")]
    InsufficientPermissions,
    #[msg("Invalid intent status transition")]
    InvalidStatusTransition,
}

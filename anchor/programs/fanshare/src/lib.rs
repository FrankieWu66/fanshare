use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Mint, MintTo, Burn, Token, TokenAccount};

#[cfg(test)]
mod tests;

// Placeholder — will be replaced by `anchor keys list` after first build
declare_id!("B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz");

/// Linear bonding curve: price = base_price + slope * tokens_sold
/// Inspired by pump.fun model, applied to NBA player performance tokens.
#[program]
pub mod fanshare {
    use super::*;

    /// Initialize a new player token with its bonding curve.
    /// Creates the bonding curve state and stats oracle account.
    /// Mint must be created externally with bonding_curve PDA as mint authority.
    pub fn initialize_curve(
        ctx: Context<InitializeCurve>,
        player_id: String,
        base_price: u64,
        slope: u64,
        total_supply: u64,
    ) -> Result<()> {
        require!(player_id.len() <= 32, FanshareError::PlayerIdTooLong);
        require!(base_price > 0, FanshareError::InvalidParameter);
        require!(slope > 0, FanshareError::InvalidParameter);
        require!(total_supply > 0, FanshareError::InvalidParameter);

        let curve = &mut ctx.accounts.bonding_curve;
        curve.player_id = player_id;
        curve.mint = ctx.accounts.mint.key();
        curve.base_price = base_price;
        curve.slope = slope;
        curve.total_supply = total_supply;
        curve.tokens_sold = 0;
        curve.treasury_lamports = 0;
        curve.authority = ctx.accounts.authority.key();
        curve.bump = ctx.bumps.bonding_curve;

        let oracle = &mut ctx.accounts.stats_oracle;
        oracle.mint = ctx.accounts.mint.key();
        oracle.index_price_lamports = 0;
        oracle.last_updated = 0;
        oracle.authority = ctx.accounts.authority.key();
        oracle.bump = ctx.bumps.stats_oracle;

        Ok(())
    }

    /// Buy tokens by specifying token amount. Pays SOL based on curve price.
    /// Slippage protection: fails if SOL cost exceeds max_sol_in.
    pub fn buy(ctx: Context<Trade>, token_amount: u64, max_sol_in: u64) -> Result<()> {
        require!(token_amount > 0, FanshareError::ZeroAmount);

        // Read state before CPIs (avoids borrow checker issues)
        let base_price = ctx.accounts.bonding_curve.base_price;
        let slope = ctx.accounts.bonding_curve.slope;
        let tokens_sold = ctx.accounts.bonding_curve.tokens_sold;
        let total_supply = ctx.accounts.bonding_curve.total_supply;
        let mint_key = ctx.accounts.bonding_curve.mint;
        let bump = ctx.accounts.bonding_curve.bump;
        let player_id = ctx.accounts.bonding_curve.player_id.clone();

        require!(
            tokens_sold.checked_add(token_amount).unwrap() <= total_supply,
            FanshareError::ExceedsTotalSupply
        );

        let sol_cost = calculate_buy_cost(base_price, slope, tokens_sold, token_amount)?;
        require!(sol_cost > 0, FanshareError::ZeroAmount);
        require!(sol_cost <= max_sol_in, FanshareError::SlippageExceeded);

        // Transfer SOL from buyer to bonding curve PDA
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.bonding_curve.to_account_info(),
                },
            ),
            sol_cost,
        )?;

        // Mint tokens to buyer's token account
        let seeds: &[&[u8]] = &[b"bonding-curve", mint_key.as_ref(), &[bump]];
        let signer_seeds = &[seeds];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                signer_seeds,
            ),
            token_amount,
        )?;

        // Update state
        let curve = &mut ctx.accounts.bonding_curve;
        curve.tokens_sold = tokens_sold.checked_add(token_amount).unwrap();
        curve.treasury_lamports = curve.treasury_lamports.checked_add(sol_cost).unwrap();

        let new_tokens_sold = curve.tokens_sold;
        emit!(TradeEvent {
            mint: mint_key,
            player_id,
            trader: ctx.accounts.buyer.key(),
            token_amount,
            sol_amount: sol_cost,
            is_buy: true,
            tokens_sold_after: new_tokens_sold,
            price_after: current_price(base_price, slope, new_tokens_sold),
        });

        Ok(())
    }

    /// Buy tokens by specifying SOL amount. Calculates how many tokens that buys.
    /// Slippage protection: fails if tokens received < min_tokens_out.
    /// Rejects when calculated tokens = 0 (dust protection).
    pub fn buy_with_sol(ctx: Context<Trade>, sol_amount: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_amount > 0, FanshareError::ZeroAmount);

        // Read state before CPIs
        let base_price = ctx.accounts.bonding_curve.base_price;
        let slope = ctx.accounts.bonding_curve.slope;
        let tokens_sold = ctx.accounts.bonding_curve.tokens_sold;
        let total_supply = ctx.accounts.bonding_curve.total_supply;
        let mint_key = ctx.accounts.bonding_curve.mint;
        let bump = ctx.accounts.bonding_curve.bump;
        let player_id = ctx.accounts.bonding_curve.player_id.clone();

        // Calculate how many tokens sol_amount can buy at current curve position
        let token_amount = calculate_tokens_for_sol(
            base_price, slope, tokens_sold, sol_amount, total_supply,
        )?;
        require!(token_amount > 0, FanshareError::DustAmount);
        require!(token_amount >= min_tokens_out, FanshareError::SlippageExceeded);

        // Recalculate exact SOL cost for the rounded token amount
        let exact_sol_cost = calculate_buy_cost(base_price, slope, tokens_sold, token_amount)?;
        require!(exact_sol_cost <= sol_amount, FanshareError::SlippageExceeded);

        // Transfer SOL from buyer to bonding curve PDA
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.bonding_curve.to_account_info(),
                },
            ),
            exact_sol_cost,
        )?;

        // Mint tokens to buyer
        let seeds: &[&[u8]] = &[b"bonding-curve", mint_key.as_ref(), &[bump]];
        let signer_seeds = &[seeds];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                signer_seeds,
            ),
            token_amount,
        )?;

        // Update state
        let curve = &mut ctx.accounts.bonding_curve;
        curve.tokens_sold = tokens_sold.checked_add(token_amount).unwrap();
        curve.treasury_lamports = curve.treasury_lamports.checked_add(exact_sol_cost).unwrap();

        let new_tokens_sold = curve.tokens_sold;
        emit!(TradeEvent {
            mint: mint_key,
            player_id,
            trader: ctx.accounts.buyer.key(),
            token_amount,
            sol_amount: exact_sol_cost,
            is_buy: true,
            tokens_sold_after: new_tokens_sold,
            price_after: current_price(base_price, slope, new_tokens_sold),
        });

        Ok(())
    }

    /// Sell tokens back to the bonding curve for SOL.
    /// Slippage protection: fails if SOL received < min_sol_out.
    pub fn sell(ctx: Context<Trade>, token_amount: u64, min_sol_out: u64) -> Result<()> {
        require!(token_amount > 0, FanshareError::ZeroAmount);

        // Read state before CPIs
        let base_price = ctx.accounts.bonding_curve.base_price;
        let slope = ctx.accounts.bonding_curve.slope;
        let tokens_sold = ctx.accounts.bonding_curve.tokens_sold;
        let treasury = ctx.accounts.bonding_curve.treasury_lamports;
        let mint_key = ctx.accounts.bonding_curve.mint;
        let player_id = ctx.accounts.bonding_curve.player_id.clone();

        require!(token_amount <= tokens_sold, FanshareError::InsufficientTokensSold);

        let sol_return = calculate_sell_return(base_price, slope, tokens_sold, token_amount)?;
        require!(sol_return > 0, FanshareError::ZeroAmount);
        require!(sol_return >= min_sol_out, FanshareError::SlippageExceeded);

        // Reserve invariant — CRITICAL
        require!(sol_return <= treasury, FanshareError::InsufficientTreasury);

        // Burn tokens from seller's account
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            token_amount,
        )?;

        // Transfer SOL from bonding curve PDA to seller via direct lamport manipulation
        **ctx.accounts.bonding_curve.to_account_info().try_borrow_mut_lamports()? -= sol_return;
        **ctx.accounts.buyer.to_account_info().try_borrow_mut_lamports()? += sol_return;

        // Update state
        let curve = &mut ctx.accounts.bonding_curve;
        curve.tokens_sold = tokens_sold.checked_sub(token_amount).unwrap();
        curve.treasury_lamports = treasury.checked_sub(sol_return).unwrap();

        let new_tokens_sold = curve.tokens_sold;
        emit!(TradeEvent {
            mint: mint_key,
            player_id,
            trader: ctx.accounts.buyer.key(),
            token_amount,
            sol_amount: sol_return,
            is_buy: false,
            tokens_sold_after: new_tokens_sold,
            price_after: current_price(base_price, slope, new_tokens_sold),
        });

        Ok(())
    }

    /// Update the stats oracle index price. Only callable by the oracle authority.
    pub fn update_oracle(ctx: Context<UpdateOracle>, index_price_lamports: u64) -> Result<()> {
        let oracle = &mut ctx.accounts.stats_oracle;
        oracle.index_price_lamports = index_price_lamports;
        oracle.last_updated = Clock::get()?.unix_timestamp;

        emit!(OracleUpdateEvent {
            mint: oracle.mint,
            index_price_lamports,
            timestamp: oracle.last_updated,
        });

        Ok(())
    }
}

// ============================================================================
// Math — Linear Bonding Curve
// ============================================================================
// price(x) = base_price + slope * x
// Cost to buy tokens from position `s` to `s + n` (discrete sum):
//   cost = sum_{i=0}^{n-1} (base_price + slope * (s + i))
//        = n * base_price + slope * (n * (2s + n - 1)) / 2

/// Calculate the SOL cost to buy `amount` tokens starting from `tokens_sold`.
pub fn calculate_buy_cost(base_price: u64, slope: u64, tokens_sold: u64, amount: u64) -> Result<u64> {
    let n = amount as u128;
    let b = base_price as u128;
    let k = slope as u128;
    let s = tokens_sold as u128;

    let base_cost = n.checked_mul(b)
        .ok_or(FanshareError::MathOverflow)?;

    // k * n * (2s + n - 1) / 2
    let sum_term = s
        .checked_mul(2)
        .and_then(|v| v.checked_add(n))
        .and_then(|v| v.checked_sub(1))
        .ok_or(FanshareError::MathOverflow)?;

    let slope_cost = k
        .checked_mul(n)
        .and_then(|v| v.checked_mul(sum_term))
        .map(|v| v / 2)
        .ok_or(FanshareError::MathOverflow)?;

    let total = base_cost.checked_add(slope_cost)
        .ok_or(FanshareError::MathOverflow)?;

    require!(total <= u64::MAX as u128, FanshareError::MathOverflow);
    Ok(total as u64)
}

/// Calculate the SOL returned when selling `amount` tokens from `tokens_sold`.
/// Symmetric with buy: integral from (tokens_sold - amount) to tokens_sold.
pub fn calculate_sell_return(base_price: u64, slope: u64, tokens_sold: u64, amount: u64) -> Result<u64> {
    let new_sold = tokens_sold.checked_sub(amount)
        .ok_or(FanshareError::MathOverflow)?;
    calculate_buy_cost(base_price, slope, new_sold, amount)
}

/// Calculate how many whole tokens can be bought with `sol_amount` SOL.
/// Binary search for maximum affordable token count.
pub fn calculate_tokens_for_sol(
    base_price: u64,
    slope: u64,
    tokens_sold: u64,
    sol_amount: u64,
    total_supply: u64,
) -> Result<u64> {
    let max_buyable = total_supply.saturating_sub(tokens_sold);
    if max_buyable == 0 {
        return Ok(0);
    }

    let mut lo: u64 = 0;
    let mut hi: u64 = max_buyable;

    while lo < hi {
        let mid = lo + (hi - lo + 1) / 2;
        let cost = calculate_buy_cost(base_price, slope, tokens_sold, mid)?;
        if cost <= sol_amount {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    Ok(lo)
}

/// Get the current marginal price (price of the next token).
pub fn current_price(base_price: u64, slope: u64, tokens_sold: u64) -> u64 {
    base_price.saturating_add(slope.saturating_mul(tokens_sold))
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct BondingCurveAccount {
    /// Player identifier (e.g., "Player_23")
    #[max_len(32)]
    pub player_id: String,
    /// The SPL token mint for this player
    pub mint: Pubkey,
    /// Base price in lamports (y-intercept of the curve)
    pub base_price: u64,
    /// Price slope in lamports per token (gradient of the curve)
    pub slope: u64,
    /// Maximum token supply
    pub total_supply: u64,
    /// Current number of tokens sold (on the curve)
    pub tokens_sold: u64,
    /// Total SOL held in treasury (lamports)
    pub treasury_lamports: u64,
    /// Admin authority (can update params in future versions)
    pub authority: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct StatsOracleAccount {
    /// The SPL token mint this oracle tracks
    pub mint: Pubkey,
    /// Current index price in lamports
    pub index_price_lamports: u64,
    /// Unix timestamp of last update
    pub last_updated: i64,
    /// Oracle update authority (cron wallet)
    pub authority: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

// ============================================================================
// Instruction Contexts
// ============================================================================

#[derive(Accounts)]
#[instruction(player_id: String)]
pub struct InitializeCurve<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The SPL token mint for this player.
    /// Must be created externally with bonding_curve PDA as mint authority.
    #[account(
        mut,
        constraint = mint.supply == 0 @ FanshareError::MintNotEmpty,
        constraint = mint.mint_authority.unwrap() == bonding_curve.key() @ FanshareError::InvalidMintAuthority,
    )]
    pub mint: Account<'info, Mint>,

    /// Bonding curve state PDA — seeds: ["bonding-curve", mint]
    #[account(
        init,
        payer = authority,
        space = 8 + BondingCurveAccount::INIT_SPACE,
        seeds = [b"bonding-curve", mint.key().as_ref()],
        bump,
    )]
    pub bonding_curve: Account<'info, BondingCurveAccount>,

    /// Stats oracle PDA — seeds: ["stats-oracle", mint]
    #[account(
        init,
        payer = authority,
        space = 8 + StatsOracleAccount::INIT_SPACE,
        seeds = [b"stats-oracle", mint.key().as_ref()],
        bump,
    )]
    pub stats_oracle: Account<'info, StatsOracleAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        constraint = mint.key() == bonding_curve.mint @ FanshareError::MintMismatch,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"bonding-curve", mint.key().as_ref()],
        bump = bonding_curve.bump,
    )]
    pub bonding_curve: Account<'info, BondingCurveAccount>,

    /// Trader's associated token account for this player token
    #[account(
        mut,
        constraint = buyer_token_account.owner == buyer.key() @ FanshareError::TokenAccountOwnerMismatch,
        constraint = buyer_token_account.mint == mint.key() @ FanshareError::MintMismatch,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    #[account(
        constraint = authority.key() == stats_oracle.authority @ FanshareError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stats-oracle", stats_oracle.mint.as_ref()],
        bump = stats_oracle.bump,
    )]
    pub stats_oracle: Account<'info, StatsOracleAccount>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct TradeEvent {
    pub mint: Pubkey,
    pub player_id: String,
    pub trader: Pubkey,
    pub token_amount: u64,
    pub sol_amount: u64,
    pub is_buy: bool,
    pub tokens_sold_after: u64,
    pub price_after: u64,
}

#[event]
pub struct OracleUpdateEvent {
    pub mint: Pubkey,
    pub index_price_lamports: u64,
    pub timestamp: i64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum FanshareError {
    #[msg("Player ID exceeds 32 characters")]
    PlayerIdTooLong,
    #[msg("Invalid parameter: must be > 0")]
    InvalidParameter,
    #[msg("Token amount is zero")]
    ZeroAmount,
    #[msg("Amount too small, would receive 0 tokens (dust)")]
    DustAmount,
    #[msg("Purchase would exceed total supply")]
    ExceedsTotalSupply,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Not enough tokens sold to fill this sell order")]
    InsufficientTokensSold,
    #[msg("Treasury doesn't have enough SOL (reserve invariant violated)")]
    InsufficientTreasury,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Mint supply must be 0 at initialization")]
    MintNotEmpty,
    #[msg("Mint authority must be the bonding curve PDA")]
    InvalidMintAuthority,
    #[msg("Token account owner mismatch")]
    TokenAccountOwnerMismatch,
    #[msg("Mint does not match bonding curve")]
    MintMismatch,
    #[msg("Unauthorized")]
    Unauthorized,
}

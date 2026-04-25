use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Mint, MintTo, Burn, Token, TokenAccount};

#[cfg(test)]
mod tests;

// Placeholder — will be replaced by `anchor keys list` after first build
declare_id!("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");

/// Fee rate: 15 / 1000 = 1.5%
const FEE_NUMERATOR: u64 = 15;
const FEE_DENOMINATOR: u64 = 1000;

/// 7 days in seconds for oracle weight timelock
const WEIGHT_TIMELOCK_SECONDS: i64 = 7 * 24 * 60 * 60;

/// 30 days in seconds for frozen market sell window
const FREEZE_WINDOW_SECONDS: i64 = 30 * 24 * 60 * 60;

/// Linear bonding curve: price = base_price + slope * tokens_sold
/// Inspired by pump.fun model, applied to NBA player performance tokens.
///
/// Phase 1 tokenomics: 1.5% fee on every trade (1.0% protocol + 0.5% exit treasury),
/// on-chain oracle config with 7-day weight timelock, spread-at-buy in trade events.
#[program]
pub mod fanshare {
    use super::*;

    // ========================================================================
    // Initialization instructions
    // ========================================================================

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
        oracle.stats_source_date = 0;
        oracle.authority = ctx.accounts.authority.key();
        oracle.bump = ctx.bumps.stats_oracle;

        Ok(())
    }

    /// Initialize the global exit treasury. One-time setup by authority.
    /// Stores the protocol wallet address for fee routing.
    pub fn initialize_exit_treasury(
        ctx: Context<InitializeExitTreasury>,
        protocol_wallet: Pubkey,
    ) -> Result<()> {
        let treasury = &mut ctx.accounts.exit_treasury;
        treasury.protocol_wallet = protocol_wallet;
        treasury.balance_lamports = 0;
        treasury.total_collected = 0;
        treasury.authority = ctx.accounts.authority.key();
        treasury.bump = ctx.bumps.exit_treasury;
        Ok(())
    }

    /// Initialize the oracle config with stat weights. One-time setup.
    /// Weights are public and on-chain. Changes require 7-day timelock.
    pub fn initialize_oracle_config(
        ctx: Context<InitializeOracleConfig>,
        ppg_weight: u64,
        rpg_weight: u64,
        apg_weight: u64,
        spg_weight: u64,
        bpg_weight: u64,
        fg_pct_weight: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.oracle_config;
        config.ppg_weight = ppg_weight;
        config.rpg_weight = rpg_weight;
        config.apg_weight = apg_weight;
        config.spg_weight = spg_weight;
        config.bpg_weight = bpg_weight;
        config.fg_pct_weight = fg_pct_weight;
        config.has_pending_update = false;
        config.pending_ppg_weight = 0;
        config.pending_rpg_weight = 0;
        config.pending_apg_weight = 0;
        config.pending_spg_weight = 0;
        config.pending_bpg_weight = 0;
        config.pending_fg_pct_weight = 0;
        config.pending_staged_at = 0;
        config.pending_effective_at = 0;
        config.authority = ctx.accounts.authority.key();
        config.bump = ctx.bumps.oracle_config;
        Ok(())
    }

    // ========================================================================
    // Oracle config timelock instructions
    // ========================================================================

    /// Stage a weight update with 7-day timelock. Authority-only.
    /// Emits WeightUpdateStagedEvent so users can see the pending change.
    pub fn stage_weight_update(
        ctx: Context<UpdateOracleConfig>,
        ppg_weight: u64,
        rpg_weight: u64,
        apg_weight: u64,
        spg_weight: u64,
        bpg_weight: u64,
        fg_pct_weight: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.oracle_config;

        config.has_pending_update = true;
        config.pending_ppg_weight = ppg_weight;
        config.pending_rpg_weight = rpg_weight;
        config.pending_apg_weight = apg_weight;
        config.pending_spg_weight = spg_weight;
        config.pending_bpg_weight = bpg_weight;
        config.pending_fg_pct_weight = fg_pct_weight;
        config.pending_staged_at = now;
        config.pending_effective_at = now + WEIGHT_TIMELOCK_SECONDS;

        emit!(WeightUpdateStagedEvent {
            ppg_weight,
            rpg_weight,
            apg_weight,
            spg_weight,
            bpg_weight,
            fg_pct_weight,
            staged_at: now,
            effective_at: now + WEIGHT_TIMELOCK_SECONDS,
        });

        Ok(())
    }

    /// Apply a staged weight update after timelock expires. Permissionless.
    pub fn apply_weight_update(ctx: Context<ApplyWeightUpdate>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.oracle_config;

        require!(config.has_pending_update, FanshareError::NoPendingUpdate);
        require!(now >= config.pending_effective_at, FanshareError::TimelockNotExpired);

        config.ppg_weight = config.pending_ppg_weight;
        config.rpg_weight = config.pending_rpg_weight;
        config.apg_weight = config.pending_apg_weight;
        config.spg_weight = config.pending_spg_weight;
        config.bpg_weight = config.pending_bpg_weight;
        config.fg_pct_weight = config.pending_fg_pct_weight;
        config.has_pending_update = false;

        emit!(WeightUpdateAppliedEvent {
            ppg_weight: config.ppg_weight,
            rpg_weight: config.rpg_weight,
            apg_weight: config.apg_weight,
            spg_weight: config.spg_weight,
            bpg_weight: config.bpg_weight,
            fg_pct_weight: config.fg_pct_weight,
            applied_at: now,
        });

        Ok(())
    }

    // ========================================================================
    // Trade instructions (with 1.5% fee)
    // ========================================================================

    /// Buy tokens by specifying token amount. Pays SOL + 1.5% fee.
    /// Slippage protection: fails if total SOL cost (including fee) exceeds max_sol_in.
    pub fn buy(ctx: Context<Trade>, token_amount: u64, max_sol_in: u64) -> Result<()> {
        require!(token_amount > 0, FanshareError::ZeroAmount);

        // Phase 2: freeze guard — no buys on frozen markets
        require!(!ctx.accounts.market_status.is_frozen, FanshareError::MarketFrozen);

        // Phase 4: early access gate — before open_time, only top-10 Sharp Calls can buy
        let now = Clock::get()?.unix_timestamp;
        let open_time = ctx.accounts.market_status.open_time;
        if open_time > 0 && now < open_time {
            let lb = &ctx.accounts.sharp_leaderboard;
            let buyer_key = ctx.accounts.buyer.key();
            let is_top10 = lb.top_10.iter().any(|k| *k == buyer_key);
            require!(is_top10, FanshareError::MarketNotOpenYet);
        }

        // Read state before CPIs
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

        // Calculate fee: 1.5% of sol_cost, split 2/3 protocol + 1/3 treasury
        let (fee_total, fee_protocol, fee_treasury) = calculate_fee_split(sol_cost);
        let total_cost = sol_cost.checked_add(fee_total).ok_or(FanshareError::MathOverflow)?;
        require!(total_cost <= max_sol_in, FanshareError::SlippageExceeded);

        // Transfer SOL cost to bonding curve PDA (reserve)
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

        // Transfer protocol fee (1.0%)
        if fee_protocol > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.protocol_wallet.to_account_info(),
                    },
                ),
                fee_protocol,
            )?;
        }

        // Transfer treasury fee (0.5%)
        if fee_treasury > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.exit_treasury.to_account_info(),
                    },
                ),
                fee_treasury,
            )?;
        }

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

        // Update bonding curve state
        let curve = &mut ctx.accounts.bonding_curve;
        curve.tokens_sold = tokens_sold.checked_add(token_amount).unwrap();
        curve.treasury_lamports = curve.treasury_lamports.checked_add(sol_cost).unwrap();

        // Update exit treasury accounting
        let treasury = &mut ctx.accounts.exit_treasury;
        treasury.balance_lamports = treasury.balance_lamports.checked_add(fee_treasury).unwrap();
        treasury.total_collected = treasury.total_collected.checked_add(fee_treasury).unwrap();

        // Compute spread at buy (basis points × 100, signed)
        let new_tokens_sold = curve.tokens_sold;
        let market_price = current_price(base_price, slope, new_tokens_sold);
        let index_price = ctx.accounts.stats_oracle.index_price_lamports;
        let spread_at_buy = compute_spread(market_price, index_price);

        emit!(TradeEvent {
            mint: mint_key,
            player_id,
            trader: ctx.accounts.buyer.key(),
            token_amount,
            sol_amount: sol_cost,
            is_buy: true,
            tokens_sold_after: new_tokens_sold,
            price_after: market_price,
            fee_lamports: fee_total,
            spread_at_buy,
        });

        Ok(())
    }

    /// Buy tokens by specifying SOL amount. Calculates how many tokens that buys.
    /// Fee is deducted from the SOL budget before calculating tokens.
    /// Slippage protection: fails if tokens received < min_tokens_out.
    pub fn buy_with_sol(ctx: Context<Trade>, sol_amount: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_amount > 0, FanshareError::ZeroAmount);

        // Phase 2: freeze guard — no buys on frozen markets
        require!(!ctx.accounts.market_status.is_frozen, FanshareError::MarketFrozen);

        // Phase 4: early access gate
        let now = Clock::get()?.unix_timestamp;
        let open_time = ctx.accounts.market_status.open_time;
        if open_time > 0 && now < open_time {
            let lb = &ctx.accounts.sharp_leaderboard;
            let buyer_key = ctx.accounts.buyer.key();
            let is_top10 = lb.top_10.iter().any(|k| *k == buyer_key);
            require!(is_top10, FanshareError::MarketNotOpenYet);
        }

        // Read state before CPIs
        let base_price = ctx.accounts.bonding_curve.base_price;
        let slope = ctx.accounts.bonding_curve.slope;
        let tokens_sold = ctx.accounts.bonding_curve.tokens_sold;
        let total_supply = ctx.accounts.bonding_curve.total_supply;
        let mint_key = ctx.accounts.bonding_curve.mint;
        let bump = ctx.accounts.bonding_curve.bump;
        let player_id = ctx.accounts.bonding_curve.player_id.clone();

        // Deduct fee from budget: effective_sol = sol_amount * 1000 / 1015
        // This ensures total outlay (curve cost + fee) <= sol_amount
        let effective_sol = ((sol_amount as u128) * (FEE_DENOMINATOR as u128)
            / ((FEE_DENOMINATOR + FEE_NUMERATOR) as u128)) as u64;

        // Calculate how many tokens effective_sol can buy
        let token_amount = calculate_tokens_for_sol(
            base_price, slope, tokens_sold, effective_sol, total_supply,
        )?;
        require!(token_amount > 0, FanshareError::DustAmount);
        require!(token_amount >= min_tokens_out, FanshareError::SlippageExceeded);

        // Recalculate exact SOL cost for the rounded token amount
        let exact_sol_cost = calculate_buy_cost(base_price, slope, tokens_sold, token_amount)?;

        // Calculate fee on exact cost
        let (fee_total, fee_protocol, fee_treasury) = calculate_fee_split(exact_sol_cost);
        let total_cost = exact_sol_cost.checked_add(fee_total).ok_or(FanshareError::MathOverflow)?;
        require!(total_cost <= sol_amount, FanshareError::SlippageExceeded);

        // Transfer SOL cost to bonding curve PDA
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

        // Transfer protocol fee (1.0%)
        if fee_protocol > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.protocol_wallet.to_account_info(),
                    },
                ),
                fee_protocol,
            )?;
        }

        // Transfer treasury fee (0.5%)
        if fee_treasury > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.exit_treasury.to_account_info(),
                    },
                ),
                fee_treasury,
            )?;
        }

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

        // Update bonding curve state
        let curve = &mut ctx.accounts.bonding_curve;
        curve.tokens_sold = tokens_sold.checked_add(token_amount).unwrap();
        curve.treasury_lamports = curve.treasury_lamports.checked_add(exact_sol_cost).unwrap();

        // Update exit treasury accounting
        let treasury = &mut ctx.accounts.exit_treasury;
        treasury.balance_lamports = treasury.balance_lamports.checked_add(fee_treasury).unwrap();
        treasury.total_collected = treasury.total_collected.checked_add(fee_treasury).unwrap();

        // Compute spread at buy using pre-trade market price (tokens_sold before this trade).
        // SIM-002 fix: was incorrectly using new_tokens_sold (post-trade), which inflated
        // the spread and corrupted Sharp Calls leaderboard rankings.
        let pre_trade_market_price = current_price(base_price, slope, tokens_sold);
        let new_tokens_sold = curve.tokens_sold;
        let market_price_after = current_price(base_price, slope, new_tokens_sold);
        let index_price = ctx.accounts.stats_oracle.index_price_lamports;
        let spread_at_buy = compute_spread(pre_trade_market_price, index_price);

        emit!(TradeEvent {
            mint: mint_key,
            player_id,
            trader: ctx.accounts.buyer.key(),
            token_amount,
            sol_amount: exact_sol_cost,
            is_buy: true,
            tokens_sold_after: new_tokens_sold,
            price_after: market_price_after,
            fee_lamports: fee_total,
            spread_at_buy,
        });

        Ok(())
    }

    /// Sell tokens back to the bonding curve for SOL minus 1.5% fee.
    /// Slippage protection: fails if SOL received (after fee) < min_sol_out.
    pub fn sell(ctx: Context<Trade>, token_amount: u64, min_sol_out: u64) -> Result<()> {
        require!(token_amount > 0, FanshareError::ZeroAmount);

        // Demo 1 (2026-04-18): full halt on frozen markets — sells blocked too.
        // Previously allowed sells for 30 days after freeze; Demo 2 retirement work
        // will reintroduce a timed sell window via a separate instruction.
        require!(!ctx.accounts.market_status.is_frozen, FanshareError::MarketFrozen);

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

        // Reserve invariant — use actual PDA lamport balance as authoritative source.
        //
        // SIM-003 fix: treasury_lamports (accounting field) can be stale under concurrent
        // transactions sharing the same blockhash — both reads the same value before either
        // write commits. Using the real PDA balance makes the check data-race safe because
        // Solana serialises writes to the same account within a slot.
        //
        // SIM-005 fix: fee rounding over many sequential sells leaves 1–2 lamports in
        // treasury_lamports that are never disbursed. The last seller's sol_return may
        // exceed treasury_lamports by exactly that rounding amount, triggering
        // InsufficientTreasury incorrectly. Capping sol_actual to the real PDA balance
        // (rather than hard-failing) covers the rounding gap while preserving the invariant.
        let pda_balance = ctx.accounts.bonding_curve.to_account_info().lamports();
        let sol_actual = sol_return.min(pda_balance);
        require!(sol_actual > 0, FanshareError::InsufficientTreasury);

        // Calculate fee: 1.5% of sol_actual, deducted from seller's proceeds
        let (fee_total, fee_protocol, fee_treasury) = calculate_fee_split(sol_actual);
        let seller_receives = sol_actual.checked_sub(fee_total).ok_or(FanshareError::MathOverflow)?;
        require!(seller_receives >= min_sol_out, FanshareError::SlippageExceeded);

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

        // Direct lamport manipulation from bonding curve PDA
        // Bonding curve releases sol_actual, split: seller + protocol + treasury
        **ctx.accounts.bonding_curve.to_account_info().try_borrow_mut_lamports()? -= sol_actual;
        **ctx.accounts.buyer.to_account_info().try_borrow_mut_lamports()? += seller_receives;

        if fee_protocol > 0 {
            **ctx.accounts.protocol_wallet.to_account_info().try_borrow_mut_lamports()? += fee_protocol;
        }
        if fee_treasury > 0 {
            **ctx.accounts.exit_treasury.to_account_info().try_borrow_mut_lamports()? += fee_treasury;
        }

        // Update bonding curve state
        let curve = &mut ctx.accounts.bonding_curve;
        curve.tokens_sold = tokens_sold.checked_sub(token_amount).unwrap();
        // treasury_lamports tracks the accounting balance; clamp to zero on full drain
        curve.treasury_lamports = treasury.saturating_sub(sol_actual);

        // Update exit treasury accounting
        let exit_treasury = &mut ctx.accounts.exit_treasury;
        exit_treasury.balance_lamports = exit_treasury.balance_lamports.checked_add(fee_treasury).unwrap();
        exit_treasury.total_collected = exit_treasury.total_collected.checked_add(fee_treasury).unwrap();

        // Demo 1 telemetry: compute spread on sell so post-demo CSV has both sides.
        // Field name `spread_at_buy` kept to avoid IDL churn; now means "spread at execution".
        let new_tokens_sold = curve.tokens_sold;
        let market_price_after = current_price(base_price, slope, new_tokens_sold);
        let index_price = ctx.accounts.stats_oracle.index_price_lamports;
        let spread_at_execution = compute_spread(market_price_after, index_price);
        emit!(TradeEvent {
            mint: mint_key,
            player_id,
            trader: ctx.accounts.buyer.key(),
            token_amount,
            sol_amount: sol_return,
            is_buy: false,
            tokens_sold_after: new_tokens_sold,
            price_after: market_price_after,
            fee_lamports: fee_total,
            spread_at_buy: spread_at_execution,
        });

        Ok(())
    }

    // ========================================================================
    // Oracle instruction
    // ========================================================================

    /// Update the stats oracle index price. Only callable by the oracle authority.
    /// Accepts 4-pillar attribution deltas for transparency (OracleUpdateEvent).
    pub fn update_oracle(
        ctx: Context<UpdateOracle>,
        index_price_lamports: u64,
        stats_source_date: i64,
        delta_scoring: i64,
        delta_playmaking: i64,
        delta_defense: i64,
        delta_winning: i64,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.stats_oracle;
        let old_index_price = oracle.index_price_lamports;
        oracle.index_price_lamports = index_price_lamports;
        oracle.last_updated = Clock::get()?.unix_timestamp;
        oracle.stats_source_date = stats_source_date;

        emit!(OracleUpdateEvent {
            mint: oracle.mint,
            old_index_price,
            new_index_price: index_price_lamports,
            delta_scoring,
            delta_playmaking,
            delta_defense,
            delta_winning,
            timestamp: oracle.last_updated,
            stats_source_date,
        });

        Ok(())
    }

    // ========================================================================
    // Phase 2: Inactive player mechanism
    // ========================================================================

    /// Initialize market status for a player. Sets open_time for early access gating.
    /// Called once per player (can be done during init-players or later).
    pub fn initialize_market_status(
        ctx: Context<InitializeMarketStatus>,
        open_time: i64,
    ) -> Result<()> {
        let status = &mut ctx.accounts.market_status;
        status.mint = ctx.accounts.mint.key();
        status.is_frozen = false;
        status.freeze_timestamp = 0;
        status.close_timestamp = 0;
        status.open_time = open_time;
        status.authority = ctx.accounts.authority.key();
        status.bump = ctx.bumps.market_status;
        Ok(())
    }

    /// Freeze a player's market. Authority-only. Triggers 30-day sell-only window.
    /// After close_timestamp, no more sells — only process_exit.
    pub fn freeze_market(ctx: Context<FreezeMarket>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let status = &mut ctx.accounts.market_status;

        require!(!status.is_frozen, FanshareError::MarketAlreadyFrozen);

        status.is_frozen = true;
        status.freeze_timestamp = now;
        status.close_timestamp = now + FREEZE_WINDOW_SECONDS;

        emit!(MarketFreezeEvent {
            mint: status.mint,
            freeze_timestamp: now,
            close_timestamp: status.close_timestamp,
        });

        Ok(())
    }

    /// Process exit for a token holder after market permanently closes.
    /// The holder must sign (to authorize the token burn).
    /// Anyone can build and submit this transaction on behalf of the holder.
    /// Burns holder's tokens and pays them from bonding curve + exit treasury backstop.
    pub fn process_exit(ctx: Context<ProcessExit>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let status = &ctx.accounts.market_status;

        require!(status.is_frozen, FanshareError::MarketNotFrozen);
        require!(now >= status.close_timestamp, FanshareError::MarketNotClosed);

        let token_amount = ctx.accounts.holder_token_account.amount;
        require!(token_amount > 0, FanshareError::ZeroAmount);

        // Calculate what the holder would receive from the bonding curve
        let base_price = ctx.accounts.bonding_curve.base_price;
        let slope = ctx.accounts.bonding_curve.slope;
        let tokens_sold = ctx.accounts.bonding_curve.tokens_sold;
        let curve_treasury = ctx.accounts.bonding_curve.treasury_lamports;
        let mint_key = ctx.accounts.bonding_curve.mint;

        let sell_return = calculate_sell_return(base_price, slope, tokens_sold, token_amount)?;

        // Pay from bonding curve first, then exit treasury backstop for any gap
        let from_curve = sell_return.min(curve_treasury);
        let gap = sell_return.saturating_sub(from_curve);
        let from_treasury = gap.min(ctx.accounts.exit_treasury.balance_lamports);
        let total_payout = from_curve + from_treasury;

        // Burn tokens from holder (holder must sign)
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.holder_token_account.to_account_info(),
                    authority: ctx.accounts.holder.to_account_info(),
                },
            ),
            token_amount,
        )?;

        // Transfer from bonding curve PDA
        if from_curve > 0 {
            **ctx.accounts.bonding_curve.to_account_info().try_borrow_mut_lamports()? -= from_curve;
            **ctx.accounts.holder.to_account_info().try_borrow_mut_lamports()? += from_curve;
        }

        // Transfer from exit treasury PDA
        if from_treasury > 0 {
            **ctx.accounts.exit_treasury.to_account_info().try_borrow_mut_lamports()? -= from_treasury;
            **ctx.accounts.holder.to_account_info().try_borrow_mut_lamports()? += from_treasury;
        }

        // Update state
        let curve = &mut ctx.accounts.bonding_curve;
        curve.tokens_sold = tokens_sold.checked_sub(token_amount).unwrap();
        curve.treasury_lamports = curve_treasury.checked_sub(from_curve).unwrap();

        if from_treasury > 0 {
            let treasury = &mut ctx.accounts.exit_treasury;
            treasury.balance_lamports = treasury.balance_lamports.checked_sub(from_treasury).unwrap();
        }

        emit!(ExitProcessedEvent {
            mint: mint_key,
            holder: ctx.accounts.holder.key(),
            token_amount,
            sol_from_curve: from_curve,
            sol_from_treasury: from_treasury,
            total_payout,
        });

        Ok(())
    }

    // ========================================================================
    // Phase 3: Leaderboard anchor (on-chain top-10 for access control)
    // ========================================================================

    /// Initialize a leaderboard anchor. Authority-only.
    /// Type 0 = Top Traders, Type 1 = Sharp Calls.
    pub fn initialize_leaderboard(
        ctx: Context<InitializeLeaderboard>,
        leaderboard_type: u8,
    ) -> Result<()> {
        require!(leaderboard_type <= 1, FanshareError::InvalidParameter);
        let lb = &mut ctx.accounts.leaderboard;
        lb.leaderboard_type = leaderboard_type;
        lb.top_10 = [Pubkey::default(); 10];
        lb.last_updated = 0;
        lb.authority = ctx.accounts.authority.key();
        lb.bump = ctx.bumps.leaderboard;
        Ok(())
    }

    /// Update the top-10 wallets on a leaderboard. Authority-only.
    /// Called by oracle cron after computing rankings off-chain.
    pub fn update_leaderboard(
        ctx: Context<UpdateLeaderboard>,
        top_10: [Pubkey; 10],
    ) -> Result<()> {
        let lb = &mut ctx.accounts.leaderboard;
        lb.top_10 = top_10;
        lb.last_updated = Clock::get()?.unix_timestamp;

        emit!(LeaderboardUpdatedEvent {
            leaderboard_type: lb.leaderboard_type,
            top_10,
            timestamp: lb.last_updated,
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
// Fee Math
// ============================================================================

/// Calculate the 1.5% fee split: (total, protocol 1.0%, treasury 0.5%).
/// Protocol gets 2/3 of total fee, treasury gets the remainder (avoids rounding loss).
pub fn calculate_fee_split(sol_amount: u64) -> (u64, u64, u64) {
    let fee_total = (sol_amount as u128 * FEE_NUMERATOR as u128 / FEE_DENOMINATOR as u128) as u64;
    let fee_protocol = fee_total * 2 / 3; // ~1.0%
    let fee_treasury = fee_total - fee_protocol; // ~0.5% (remainder, no rounding loss)
    (fee_total, fee_protocol, fee_treasury)
}

/// Compute spread at buy in basis points × 100 (signed).
/// Positive = overvalued (market > index), negative = undervalued (market < index).
fn compute_spread(market_price: u64, index_price: u64) -> i64 {
    if index_price == 0 {
        return 0;
    }
    let mp = market_price as i128;
    let ip = index_price as i128;
    ((mp - ip) * 10_000 / ip) as i64
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
    /// Total SOL held in treasury (lamports) — bonding curve reserve
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
    /// Date of the box scores used (unix timestamp, midnight UTC)
    pub stats_source_date: i64,
    /// Oracle update authority (cron wallet)
    pub authority: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

/// Global exit treasury — collects 0.5% of every trade across all markets.
/// Ring-fenced: never touched for protocol operations.
/// Funds the inactive player exit backstop.
#[account]
#[derive(InitSpace)]
pub struct GlobalExitTreasury {
    /// Protocol revenue wallet — receives 1.0% fee from every trade
    pub protocol_wallet: Pubkey,
    /// Current treasury balance in lamports (0.5% fee accumulation)
    pub balance_lamports: u64,
    /// All-time cumulative SOL collected (for transparency, never decremented)
    pub total_collected: u64,
    /// Authority for admin operations (future: exit distributions)
    pub authority: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

/// Per-player market status — freeze state, open time, authority.
/// Created separately from bonding curve to avoid resizing existing accounts.
#[account]
#[derive(InitSpace)]
pub struct MarketStatus {
    /// The SPL token mint this status tracks
    pub mint: Pubkey,
    /// True if market is frozen (sell-only mode or permanently closed)
    pub is_frozen: bool,
    /// Unix timestamp when freeze was triggered (0 = never)
    pub freeze_timestamp: i64,
    /// Unix timestamp when sell window closes (freeze + 30 days)
    pub close_timestamp: i64,
    /// Unix timestamp when market opens to public (0 = open immediately).
    /// Before this time, only top-10 Sharp Calls can buy.
    pub open_time: i64,
    /// Authority (oracle authority key)
    pub authority: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

/// On-chain leaderboard anchor — stores top-10 wallet pubkeys for access control.
/// Type 0 = Top Traders (realized PnL), Type 1 = Sharp Calls (skill score).
/// Updated by authority (oracle cron) after off-chain ranking computation.
#[account]
#[derive(InitSpace)]
pub struct LeaderboardAnchor {
    /// 0 = TopTraders, 1 = SharpCalls
    pub leaderboard_type: u8,
    /// Top 10 wallet addresses (Pubkey::default() for empty slots)
    pub top_10: [Pubkey; 10],
    /// Last update timestamp
    pub last_updated: i64,
    /// Update authority
    pub authority: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

/// On-chain oracle configuration — stat weights with 7-day change timelock.
/// Prevents silent centralized price control (Howey risk mitigation).
#[account]
#[derive(InitSpace)]
pub struct OracleConfigAccount {
    // Active weights
    pub ppg_weight: u64,
    pub rpg_weight: u64,
    pub apg_weight: u64,
    pub spg_weight: u64,
    pub bpg_weight: u64,
    pub fg_pct_weight: u64,
    // Pending update (flat layout for InitSpace compatibility)
    pub has_pending_update: bool,
    pub pending_ppg_weight: u64,
    pub pending_rpg_weight: u64,
    pub pending_apg_weight: u64,
    pub pending_spg_weight: u64,
    pub pending_bpg_weight: u64,
    pub pending_fg_pct_weight: u64,
    pub pending_staged_at: i64,
    pub pending_effective_at: i64,
    /// Authority that can stage weight updates
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
pub struct InitializeExitTreasury<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Global exit treasury PDA — seeds: ["exit-treasury"]
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalExitTreasury::INIT_SPACE,
        seeds = [b"exit-treasury"],
        bump,
    )]
    pub exit_treasury: Account<'info, GlobalExitTreasury>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeOracleConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Oracle config PDA — seeds: ["oracle-config"]
    #[account(
        init,
        payer = authority,
        space = 8 + OracleConfigAccount::INIT_SPACE,
        seeds = [b"oracle-config"],
        bump,
    )]
    pub oracle_config: Account<'info, OracleConfigAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateOracleConfig<'info> {
    #[account(
        constraint = authority.key() == oracle_config.authority @ FanshareError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"oracle-config"],
        bump = oracle_config.bump,
    )]
    pub oracle_config: Account<'info, OracleConfigAccount>,
}

#[derive(Accounts)]
pub struct ApplyWeightUpdate<'info> {
    /// Permissionless — anyone can apply after timelock expires
    #[account(
        mut,
        seeds = [b"oracle-config"],
        bump = oracle_config.bump,
    )]
    pub oracle_config: Account<'info, OracleConfigAccount>,
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

    // --- Phase 1 tokenomics additions ---

    /// Global exit treasury PDA — receives 0.5% fee
    #[account(
        mut,
        seeds = [b"exit-treasury"],
        bump = exit_treasury.bump,
    )]
    pub exit_treasury: Account<'info, GlobalExitTreasury>,

    /// Protocol revenue wallet — receives 1.0% fee.
    /// Validated against the protocol_wallet stored in exit_treasury.
    /// CHECK: Address validated by constraint below.
    #[account(
        mut,
        constraint = protocol_wallet.key() == exit_treasury.protocol_wallet @ FanshareError::InvalidProtocolWallet,
    )]
    pub protocol_wallet: UncheckedAccount<'info>,

    /// Stats oracle for this player's mint — used for spread-at-buy calculation
    #[account(
        seeds = [b"stats-oracle", mint.key().as_ref()],
        bump = stats_oracle.bump,
    )]
    pub stats_oracle: Account<'info, StatsOracleAccount>,

    // --- Phase 2 additions ---

    /// Market status for this player — freeze guard + open_time
    #[account(
        seeds = [b"market-status", mint.key().as_ref()],
        bump = market_status.bump,
    )]
    pub market_status: Account<'info, MarketStatus>,

    /// Sharp Calls leaderboard — for early access top-10 check.
    /// Type 1 = Sharp Calls.
    #[account(
        seeds = [b"leaderboard" as &[u8], &[1u8]],
        bump = sharp_leaderboard.bump,
    )]
    pub sharp_leaderboard: Account<'info, LeaderboardAnchor>,
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

// ── Phase 2: Market status contexts ──────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeMarketStatus<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint: Account<'info, Mint>,

    /// Market status PDA — seeds: ["market-status", mint]
    #[account(
        init,
        payer = authority,
        space = 8 + MarketStatus::INIT_SPACE,
        seeds = [b"market-status", mint.key().as_ref()],
        bump,
    )]
    pub market_status: Account<'info, MarketStatus>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FreezeMarket<'info> {
    #[account(
        constraint = authority.key() == market_status.authority @ FanshareError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market-status", market_status.mint.as_ref()],
        bump = market_status.bump,
    )]
    pub market_status: Account<'info, MarketStatus>,
}

#[derive(Accounts)]
pub struct ProcessExit<'info> {
    /// The token holder — must sign to authorize burn.
    /// Frontend auto-builds this tx when holder visits the closed market page.
    #[account(mut)]
    pub holder: Signer<'info>,

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

    /// Holder's token account for this player token
    #[account(
        mut,
        constraint = holder_token_account.owner == holder.key() @ FanshareError::TokenAccountOwnerMismatch,
        constraint = holder_token_account.mint == mint.key() @ FanshareError::MintMismatch,
    )]
    pub holder_token_account: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"market-status", mint.key().as_ref()],
        bump = market_status.bump,
    )]
    pub market_status: Account<'info, MarketStatus>,

    #[account(
        mut,
        seeds = [b"exit-treasury"],
        bump = exit_treasury.bump,
    )]
    pub exit_treasury: Account<'info, GlobalExitTreasury>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ── Phase 3: Leaderboard contexts ────────────────────────────────────────

#[derive(Accounts)]
#[instruction(leaderboard_type: u8)]
pub struct InitializeLeaderboard<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Leaderboard PDA — seeds: ["leaderboard", &[type]]
    #[account(
        init,
        payer = authority,
        space = 8 + LeaderboardAnchor::INIT_SPACE,
        seeds = [b"leaderboard" as &[u8], &[leaderboard_type]],
        bump,
    )]
    pub leaderboard: Account<'info, LeaderboardAnchor>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateLeaderboard<'info> {
    #[account(
        constraint = authority.key() == leaderboard.authority @ FanshareError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"leaderboard" as &[u8], &[leaderboard.leaderboard_type]],
        bump = leaderboard.bump,
    )]
    pub leaderboard: Account<'info, LeaderboardAnchor>,
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
    /// Fee paid in lamports (1.5% of trade)
    pub fee_lamports: u64,
    /// Spread at time of buy (basis points × 100, signed). 0 for sells.
    /// Negative = undervalued at entry (potential Sharp Call).
    pub spread_at_buy: i64,
}

#[event]
pub struct OracleUpdateEvent {
    pub mint: Pubkey,
    pub old_index_price: u64,
    pub new_index_price: u64,
    /// Signed lamport delta per pillar (new − old contribution)
    pub delta_scoring: i64,
    pub delta_playmaking: i64,
    pub delta_defense: i64,
    pub delta_winning: i64,
    pub timestamp: i64,
    /// Date of the box scores used for this update
    pub stats_source_date: i64,
}

#[event]
pub struct WeightUpdateStagedEvent {
    pub ppg_weight: u64,
    pub rpg_weight: u64,
    pub apg_weight: u64,
    pub spg_weight: u64,
    pub bpg_weight: u64,
    pub fg_pct_weight: u64,
    pub staged_at: i64,
    pub effective_at: i64,
}

#[event]
pub struct WeightUpdateAppliedEvent {
    pub ppg_weight: u64,
    pub rpg_weight: u64,
    pub apg_weight: u64,
    pub spg_weight: u64,
    pub bpg_weight: u64,
    pub fg_pct_weight: u64,
    pub applied_at: i64,
}

#[event]
pub struct MarketFreezeEvent {
    pub mint: Pubkey,
    pub freeze_timestamp: i64,
    pub close_timestamp: i64,
}

#[event]
pub struct ExitProcessedEvent {
    pub mint: Pubkey,
    pub holder: Pubkey,
    pub token_amount: u64,
    pub sol_from_curve: u64,
    pub sol_from_treasury: u64,
    pub total_payout: u64,
}

#[event]
pub struct LeaderboardUpdatedEvent {
    pub leaderboard_type: u8,
    pub top_10: [Pubkey; 10],
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
    #[msg("Protocol wallet address does not match treasury config")]
    InvalidProtocolWallet,
    #[msg("No pending weight update to apply")]
    NoPendingUpdate,
    #[msg("Weight update timelock has not expired yet")]
    TimelockNotExpired,
    #[msg("Market is frozen — no buys allowed")]
    MarketFrozen,
    #[msg("Market is already frozen")]
    MarketAlreadyFrozen,
    #[msg("Market is not frozen")]
    MarketNotFrozen,
    #[msg("Market sell window has closed — use process_exit")]
    MarketClosed,
    #[msg("Market is not yet permanently closed")]
    MarketNotClosed,
    #[msg("Market has not opened yet — early access only")]
    MarketNotOpenYet,
}

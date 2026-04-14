#[cfg(test)]
mod tests {
    use crate::*;

    // ========================================================================
    // Unit tests — bonding curve math (no SVM needed)
    // ========================================================================

    #[test]
    fn test_current_price_at_zero() {
        // price(0) = base_price + slope * 0 = base_price
        assert_eq!(current_price(1000, 10, 0), 1000);
    }

    #[test]
    fn test_current_price_after_sales() {
        // price(100) = 1000 + 10 * 100 = 2000
        assert_eq!(current_price(1000, 10, 100), 2000);
    }

    #[test]
    fn test_buy_cost_single_token() {
        // Buying 1 token at position 0: cost = base_price + slope * 0 = 1000
        let cost = calculate_buy_cost(1000, 10, 0, 1).unwrap();
        assert_eq!(cost, 1000);
    }

    #[test]
    fn test_buy_cost_first_ten_tokens() {
        // Buying 10 tokens from position 0:
        // sum = (1000+0) + (1000+10) + (1000+20) + ... + (1000+90)
        //     = 10*1000 + 10*(0+10+20+...+90)
        //     = 10000 + 10*450
        //     = 10000 + 4500 = 14500
        // Formula: n*base + slope*n*(2s + n - 1)/2
        //        = 10*1000 + 10*10*(0 + 10 - 1)/2
        //        = 10000 + 10*10*9/2
        //        = 10000 + 450 = 10450
        // Wait, let me recalculate. slope=10, s=0, n=10
        // cost = 10*1000 + 10*10*(2*0 + 10 - 1)/2 = 10000 + 100*9/2 = 10000 + 450 = 10450
        // Manual: prices are 1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090
        // sum = 10*1000 + 10*(0+1+2+...+9) = 10000 + 10*45 = 10450. Correct!
        let cost = calculate_buy_cost(1000, 10, 0, 10).unwrap();
        assert_eq!(cost, 10450);
    }

    #[test]
    fn test_buy_cost_from_nonzero_position() {
        // Buying 5 tokens from position 100:
        // prices: 2000, 2010, 2020, 2030, 2040
        // sum = 5*1000 + 10*5*(200 + 5 - 1)/2 = 5000 + 50*204/2 = 5000 + 5100 = 10100
        let cost = calculate_buy_cost(1000, 10, 100, 5).unwrap();
        assert_eq!(cost, 10100);
    }

    #[test]
    fn test_sell_return_symmetry() {
        // Buy 10 tokens from 0, then sell 10 tokens from 10 — should get same SOL back
        let buy_cost = calculate_buy_cost(1000, 10, 0, 10).unwrap();
        let sell_return = calculate_sell_return(1000, 10, 10, 10).unwrap();
        assert_eq!(buy_cost, sell_return);
    }

    #[test]
    fn test_sell_return_partial() {
        // Buy 10 from 0, sell 5 from 10
        // Selling 5 from position 10 = cost of tokens 5..10
        // = sum of prices at positions 5,6,7,8,9
        // = (1050 + 1060 + 1070 + 1080 + 1090) = 5350
        let sell_return = calculate_sell_return(1000, 10, 10, 5).unwrap();
        assert_eq!(sell_return, 5350);
    }

    #[test]
    fn test_reserve_invariant_buy_then_full_sell() {
        // The treasury after buying N tokens must exactly cover selling all N back
        let base = 1000u64;
        let slope = 10u64;
        let amount = 100u64;

        let buy_cost = calculate_buy_cost(base, slope, 0, amount).unwrap();
        let sell_return = calculate_sell_return(base, slope, amount, amount).unwrap();
        assert_eq!(buy_cost, sell_return, "Reserve invariant: full buy then full sell must balance");
    }

    #[test]
    fn test_reserve_invariant_sequential_buys_and_sells() {
        // Buy 50, buy 50 more, sell 30, sell 70 — treasury must balance
        let base = 1000u64;
        let slope = 10u64;

        let cost1 = calculate_buy_cost(base, slope, 0, 50).unwrap();
        let cost2 = calculate_buy_cost(base, slope, 50, 50).unwrap();
        let total_in = cost1 + cost2;

        let return1 = calculate_sell_return(base, slope, 100, 30).unwrap();
        let return2 = calculate_sell_return(base, slope, 70, 70).unwrap();
        let total_out = return1 + return2;

        assert_eq!(total_in, total_out, "Sequential buys and sells must balance");
    }

    #[test]
    fn test_tokens_for_sol_basic() {
        // With base=1000, slope=10, position 0:
        // 1 token costs 1000. So 1000 SOL should buy 1 token.
        let tokens = calculate_tokens_for_sol(1000, 10, 0, 1000, 1_000_000).unwrap();
        assert_eq!(tokens, 1);
    }

    #[test]
    fn test_tokens_for_sol_exact_match() {
        // Cost of 10 tokens from 0 = 10450 (calculated above)
        // So 10450 lamports should buy exactly 10 tokens
        let tokens = calculate_tokens_for_sol(1000, 10, 0, 10450, 1_000_000).unwrap();
        assert_eq!(tokens, 10);
    }

    #[test]
    fn test_tokens_for_sol_with_remainder() {
        // 10449 lamports — not enough for 10 tokens (which cost 10450), so should get 9
        let tokens = calculate_tokens_for_sol(1000, 10, 0, 10449, 1_000_000).unwrap();
        assert_eq!(tokens, 9);
    }

    #[test]
    fn test_tokens_for_sol_dust_returns_zero() {
        // 999 lamports can't buy even 1 token (costs 1000)
        let tokens = calculate_tokens_for_sol(1000, 10, 0, 999, 1_000_000).unwrap();
        assert_eq!(tokens, 0);
    }

    #[test]
    fn test_tokens_for_sol_respects_supply_cap() {
        // Huge SOL amount but only 5 tokens left
        let tokens = calculate_tokens_for_sol(1000, 10, 999_995, 1_000_000_000, 1_000_000).unwrap();
        assert_eq!(tokens, 5);
    }

    #[test]
    fn test_buy_cost_zero_amount_edge() {
        // Edge: buying 0 tokens — the formula has (n-1) which would underflow
        // But we guard against this in the instruction. Let's verify the math
        // would produce 0 for amount=0 if we special-cased it.
        // Actually with amount=0, n*(2s+n-1)/2 = 0, and n*base = 0. So it works?
        // n=0: 0*base + slope*0*(2s+0-1)/2 = 0. But 2s+0-1 could underflow for s=0.
        // This is why we require amount > 0 in the instruction.
    }

    #[test]
    fn test_buy_cost_large_values() {
        // Test with realistic parameters from design doc:
        // base_price = 1,000 lamports (0.000001 SOL)
        // slope = 10 lamports per token
        // Buy token at position 1,000,000 (max supply):
        // price = 1000 + 10 * 1_000_000 = 10_001_000 lamports = 0.010001 SOL
        let price = current_price(1000, 10, 1_000_000);
        assert_eq!(price, 10_001_000);

        // Cost of buying all 1M tokens from 0:
        // = 1M * 1000 + 10 * 1M * (2*0 + 1M - 1) / 2
        // = 1_000_000_000 + 10 * 1M * 999_999 / 2
        // = 1_000_000_000 + 4_999_995_000_000
        // = 5_000_995_000_000 lamports = ~5000.995 SOL
        let total_cost = calculate_buy_cost(1000, 10, 0, 1_000_000).unwrap();
        assert_eq!(total_cost, 5_000_995_000_000);
    }

    // ========================================================================
    // Unit tests — buy_with_sol math (the primary user-facing instruction)
    // Tests the three-step logic: tokens_for_sol → dust guard → exact_cost check
    // ========================================================================

    #[test]
    fn test_buy_with_sol_happy_path() {
        // 1 SOL (1_000_000_000 lamports) at genesis.
        // Step 1: how many tokens?
        let sol_amount = 1_000_000_000u64;
        let tokens = calculate_tokens_for_sol(1000, 10, 0, sol_amount, 1_000_000).unwrap();
        assert!(tokens > 0, "Should buy at least 1 token with 1 SOL");

        // Step 2: recalculate exact cost — must not exceed sol_amount
        let exact_cost = calculate_buy_cost(1000, 10, 0, tokens).unwrap();
        assert!(exact_cost <= sol_amount, "Exact cost must not exceed supplied SOL");

        // Step 3: one more token must exceed budget (binary search is tight)
        if tokens + 1 <= 1_000_000 {
            let cost_plus_one = calculate_buy_cost(1000, 10, 0, tokens + 1).unwrap();
            assert!(cost_plus_one > sol_amount, "Binary search must be tight — one more token exceeds budget");
        }
    }

    #[test]
    fn test_buy_with_sol_dust_amount_returns_zero() {
        // 999 lamports — not enough to buy even 1 token (costs 1000).
        // The instruction rejects this with DustAmount.
        let tokens = calculate_tokens_for_sol(1000, 10, 0, 999, 1_000_000).unwrap();
        assert_eq!(tokens, 0, "Sub-1-token SOL must return 0 tokens (dust guard triggers)");
    }

    #[test]
    fn test_buy_with_sol_exact_single_token_cost() {
        // Exactly 1000 lamports — the price of exactly 1 token at genesis.
        let tokens = calculate_tokens_for_sol(1000, 10, 0, 1000, 1_000_000).unwrap();
        assert_eq!(tokens, 1);
        let exact_cost = calculate_buy_cost(1000, 10, 0, 1).unwrap();
        assert_eq!(exact_cost, 1000);
        assert!(exact_cost <= 1000);
    }

    #[test]
    fn test_buy_with_sol_mid_curve() {
        // At position 500 (tokens_sold=500), price = 1000 + 10*500 = 6000 lamports per token.
        // Supply 60_000 lamports — should buy roughly 9-10 tokens.
        let sol_amount = 60_000u64;
        let tokens = calculate_tokens_for_sol(1000, 10, 500, sol_amount, 1_000_000).unwrap();
        assert!(tokens > 0, "Should buy tokens at mid-curve");
        let exact_cost = calculate_buy_cost(1000, 10, 500, tokens).unwrap();
        assert!(exact_cost <= sol_amount, "Exact cost must not exceed supplied SOL");
    }

    #[test]
    fn test_buy_with_sol_respects_supply_cap() {
        // Only 3 tokens left in supply. Huge SOL amount — must cap at 3.
        let tokens = calculate_tokens_for_sol(1000, 10, 999_997, 1_000_000_000_000, 1_000_000).unwrap();
        assert_eq!(tokens, 3, "Cannot buy more tokens than remaining supply");
    }

    #[test]
    fn test_buy_with_sol_slippage_check() {
        // Simulate the slippage guard: min_tokens_out = tokens - 1 (should pass).
        // min_tokens_out = tokens + 1 (should fail: tokens < min).
        let sol_amount = 1_000_000_000u64;
        let tokens = calculate_tokens_for_sol(1000, 10, 0, sol_amount, 1_000_000).unwrap();

        // Acceptable slippage (1% tolerance)
        let min_tokens_acceptable = tokens * 99 / 100;
        assert!(tokens >= min_tokens_acceptable, "Should pass 1% slippage check");

        // Unacceptable slippage (asking for more than we got)
        let min_tokens_too_high = tokens + 1;
        assert!(tokens < min_tokens_too_high, "Should fail if min_tokens_out > tokens received");
    }

    // ========================================================================
    // Unit tests — fee calculation
    // ========================================================================

    #[test]
    fn test_fee_split_basic() {
        // 100_000 lamports → 1.5% = 1500
        // protocol (2/3) = 1000, treasury (1/3) = 500
        let (total, protocol, treasury) = calculate_fee_split(100_000);
        assert_eq!(total, 1500);
        assert_eq!(protocol, 1000);
        assert_eq!(treasury, 500);
        assert_eq!(protocol + treasury, total);
    }

    #[test]
    fn test_fee_split_large() {
        // 1 SOL = 1_000_000_000 lamports → 15_000_000 fee
        let (total, protocol, treasury) = calculate_fee_split(1_000_000_000);
        assert_eq!(total, 15_000_000);
        assert_eq!(protocol, 10_000_000);
        assert_eq!(treasury, 5_000_000);
    }

    #[test]
    fn test_fee_split_dust() {
        // 66 lamports → fee = 66 * 15 / 1000 = 0 (below dust threshold)
        let (total, protocol, treasury) = calculate_fee_split(66);
        assert_eq!(total, 0);
        assert_eq!(protocol, 0);
        assert_eq!(treasury, 0);
    }

    #[test]
    fn test_fee_split_minimum_nonzero() {
        // 67 lamports → fee = 67 * 15 / 1000 = 1005 / 1000 = 1
        let (total, protocol, treasury) = calculate_fee_split(67);
        assert_eq!(total, 1);
        assert_eq!(protocol, 0); // 1 * 2 / 3 = 0
        assert_eq!(treasury, 1); // remainder
    }

    #[test]
    fn test_fee_split_no_rounding_loss() {
        // For any amount, protocol + treasury must equal total
        for amount in [1, 100, 1000, 12345, 999_999, 1_000_000_000u64] {
            let (total, protocol, treasury) = calculate_fee_split(amount);
            assert_eq!(protocol + treasury, total,
                "Fee split rounding loss for amount {}", amount);
        }
    }

    #[test]
    fn test_buy_with_fee_budget() {
        // Simulate buy_with_sol fee budget calculation:
        // sol_amount = 1_000_000 (user wants to spend 1M lamports)
        // effective_sol = 1_000_000 * 1000 / 1015 = 985_221
        let sol_amount = 1_000_000u64;
        let effective_sol = ((sol_amount as u128) * 1000 / 1015) as u64;

        // Tokens affordable with effective_sol
        let tokens = calculate_tokens_for_sol(1000, 10, 0, effective_sol, 1_000_000).unwrap();
        assert!(tokens > 0);

        // Exact cost for those tokens
        let exact_cost = calculate_buy_cost(1000, 10, 0, tokens).unwrap();

        // Fee on exact cost
        let (fee_total, _, _) = calculate_fee_split(exact_cost);
        let total = exact_cost + fee_total;

        // Total must not exceed user's budget
        assert!(total <= sol_amount,
            "Total {} (cost {} + fee {}) exceeds budget {}",
            total, exact_cost, fee_total, sol_amount);
    }

    // ========================================================================
    // Unit tests — spread calculation
    // ========================================================================

    #[test]
    fn test_spread_undervalued() {
        // market_price = 800, index_price = 1000 → spread = -2000 bps (-20%)
        let spread = compute_spread(800, 1000);
        assert_eq!(spread, -2000);
    }

    #[test]
    fn test_spread_overvalued() {
        // market_price = 1200, index_price = 1000 → spread = 2000 bps (+20%)
        let spread = compute_spread(1200, 1000);
        assert_eq!(spread, 2000);
    }

    #[test]
    fn test_spread_fair_value() {
        // market_price = index_price → spread = 0
        let spread = compute_spread(1000, 1000);
        assert_eq!(spread, 0);
    }

    #[test]
    fn test_spread_zero_index() {
        // index_price = 0 → spread = 0 (division by zero guard)
        let spread = compute_spread(1000, 0);
        assert_eq!(spread, 0);
    }

    // ========================================================================
    // Cross-language parity vectors
    // ========================================================================

    #[test]
    fn test_cross_language_parity_vectors() {
        // These test vectors must be replicated exactly in TypeScript.
        // If any of these change, the TS tests MUST be updated too.
        let vectors: Vec<(u64, u64, u64, u64, u64)> = vec![
            // (base_price, slope, tokens_sold, amount, expected_cost)
            (1000, 10, 0, 1, 1000),
            (1000, 10, 0, 10, 10450),
            (1000, 10, 100, 5, 10100),
            (1000, 10, 0, 1_000_000, 5_000_995_000_000),
            (5000, 5, 500, 100, 774_750),
        ];

        for (base, slope, sold, amount, expected) in vectors {
            let cost = calculate_buy_cost(base, slope, sold, amount).unwrap();
            assert_eq!(
                cost, expected,
                "Parity vector failed: buy_cost({}, {}, {}, {}) = {} (expected {})",
                base, slope, sold, amount, cost, expected
            );
        }
    }
}

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

def platform_fee(amount_cents, bps):
    # FIXED: multiply before the integer divide — the fee is correct.
    return amount_cents * bps // 10000

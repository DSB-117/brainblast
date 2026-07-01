def platform_fee(amount_cents, bps):
    # VULNERABLE: integer-divides FIRST, so any amount < 10000 cents truncates to
    # 0 and the fee is silently zero. Looks plausible; loses revenue on every small
    # charge.
    return amount_cents // 10000 * bps

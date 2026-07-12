from x402.http.paywall import _get_display_amount
from x402.schemas import PaymentRequired, PaymentRequirements


def test_get_display_amount_uses_evm_asset_decimals():
    payment_required = PaymentRequired(
        x402_version=2,
        accepts=[
            PaymentRequirements(
                scheme="exact",
                network="eip155:4326",
                asset="0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
                amount="1000000000000000000",
                pay_to="0x1234567890123456789012345678901234567890",
                max_timeout_seconds=300,
            )
        ],
    )

    assert _get_display_amount(payment_required) == 1.0

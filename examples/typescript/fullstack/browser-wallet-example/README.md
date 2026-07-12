# `@x402/browser-wallet-example`

Fullstack browser-wallet example for x402 using a React client and a Hono server.

The server sells two paid actions on Base Sepolia:

- `POST /api/pay/session` - creates a 24-hour session token
- `POST /api/pay/onetime` - creates a single-use token valid for 5 minutes

The React client connects to an injected EVM wallet, auto-switches to Base Sepolia, pays the selected route with x402, and then uses the returned session token against free status and consume endpoints.

## Prerequisites

- Node.js `22.21.1` or newer
- pnpm `10`
- A browser wallet such as MetaMask
- Base Sepolia ETH and USDC in the client wallet
- A Base Sepolia recipient address for `ADDRESS`

## Setup

1. Copy `.env-local` to `.env` and fill in `ADDRESS`.

```bash
cp .env-local .env
```

2. Install workspace dependencies and build the x402 packages this example imports.

```bash
source ~/.nvm/nvm.sh
nvm use 22.21.1

pnpm -C ../../../typescript install
pnpm -C ../../../typescript --filter @x402/core --filter @x402/evm --filter @x402/hono build

pnpm -C ../../ install
```

3. Start the server and client in separate terminals.

```bash
pnpm dev:server
pnpm dev:client
```

Then open `http://localhost:5173`.

## Notes

- The default facilitator URL is the public testnet facilitator. Do not point this example at Base Mainnet without providing a mainnet-compatible facilitator.
- Sessions are stored in memory. Restarting the server clears them.
- The session endpoints are the paid resources. Status and consume endpoints are free and demonstrate what you can gate after payment.

## Validation

```bash
pnpm lint:check
pnpm build
```

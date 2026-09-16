# TUCK Store — Cloudflare + Razorpay

This version keeps the TUCK storefront static while adding a secure Cloudflare Worker API for Razorpay payments.

PRODUCT PRICES
- T-shirts: ₹999 — sizes S, M, L
- Bookmark: ₹99
- Caps: ₹449
- 100 Sheep Canvas: displayed as coming soon because no price was supplied

RAZORPAY FLOW
1. The browser sends the selected product IDs/sizes and customer details to /api/create-order.
2. The Cloudflare Worker validates the catalog and calculates the amount server-side.
3. The Worker creates a Razorpay Order and returns the public Key ID + Order ID.
4. Razorpay Checkout opens in the browser.
5. After payment, the browser sends Razorpay's payment response to /api/verify-payment.
6. The Worker retrieves the Razorpay order/payment, verifies the HMAC signature, checks the amount/order match, and requires the payment to be captured before showing the paid confirmation.

SECURITY
- Never put RAZORPAY_KEY_SECRET in index.html, script.js, GitHub, or wrangler.jsonc.
- Store RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET as Cloudflare Worker secrets.
- The Worker does not trust prices sent by the browser; it has its own catalog.
- The client-side Razorpay Key ID is safe to expose, while the Key Secret remains server-side.

CLOUDFLARE SETUP
This project uses Workers Static Assets with the repository root as the asset directory and /api/* routed through the Worker.

Add the secrets from the project root:

  npx wrangler secret put RAZORPAY_KEY_ID
  npx wrangler secret put RAZORPAY_KEY_SECRET

For local testing, create .dev.vars (do not commit it):

  RAZORPAY_KEY_ID="rzp_test_..."
  RAZORPAY_KEY_SECRET="..."

Then test locally:

  npx wrangler dev

Deploy manually with:

  npx wrangler deploy

If using Cloudflare Git integration, point the Worker project at this repository and make sure Wrangler is used for the deployment. The required secrets still need to be configured in the Cloudflare Worker environment.

GO-LIVE
- Use Razorpay Test Mode first.
- Test successful and failed payments.
- Generate Live Mode API keys only when ready to accept real payments.
- Configure Razorpay automatic capture / payment webhooks before fulfillment at scale.

IMPORTANT LIMITATION
This version verifies payments immediately through the Razorpay API, but it does not yet maintain a separate TUCK order database. Razorpay itself will contain the order/payment and the customer/order notes supplied when the order is created. For a larger operation, add Cloudflare D1/KV and a webhook endpoint so orders are persisted independently of the browser.

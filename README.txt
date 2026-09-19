# TUCK Store — Cloudflare, D1, Razorpay and Resend

This package contains the TUCK storefront, Worker API, Razorpay checkout and webhook reconciliation, D1 order/customer/inventory storage, customer email notifications, and the TUCK Admin dashboard.

ORDER FLOW

1. The browser sends product IDs, sizes, and delivery details to /api/create-order.
2. The Worker calculates prices from its own catalog, checks inventory, creates the Razorpay order, and records a pending D1 order.
3. Razorpay Checkout handles payment details. TUCK never stores full card details.
4. /api/verify-payment verifies the browser result for immediate confirmation.
5. /api/razorpay-webhook independently reconciles captured payments and refunds, even if the customer closes the browser.
6. A successful captured payment updates D1, reduces tracked inventory once, records order history, and sends the confirmation email.
7. TUCK Admin supports fulfillment status, courier/tracking, private notes, order history, customers, inventory, and newsletter consent.

SECURITY

- Never commit RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RESEND_API_KEY, or ADMIN_TOKEN.
- All totals are calculated server-side from CATALOG in worker.js.
- Webhooks are verified against the unmodified request body.
- Customer-facing email is always sent as TUCK Orders <orders@tuckshop.in>, with replies to support@tuckshop.in.
- Put /admin.html and /api/admin/* behind Cloudflare Access in production. ADMIN_TOKEN remains a second layer.
- Restrict access to customer data, avoid copying it into logs, and delete it when it is no longer required for fulfillment, support, fraud prevention, tax, accounting, or legal obligations.

See PRODUCTION-ORDER-SETUP.txt for the exact deployment checklist.

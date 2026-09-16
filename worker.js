const CATALOG = Object.freeze({
  'fear-kills': {name: 'Fear Kills Tee', price: 999, requiresSize: true},
  'fear-hurts': {name: 'Fear Hurts Tee', price: 999, requiresSize: true},
  'fear-not': {name: 'Fear Not Tee', price: 999, requiresSize: true},
  'i-am-afraid': {name: 'I Am Afraid Tee', price: 999, requiresSize: true},
  'bookmark-99': {name: "He'd Leave the 99 Bookmark", price: 99, requiresSize: false},
  'cap-tuck-white': {name: 'TUCK Classic Cap', price: 449, requiresSize: false},
  'cap-statement-mouth': {name: 'Please Keep the Word Cap', price: 449, requiresSize: false}
});

const ALLOWED_SIZES = new Set(['S','M','L']);

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {'content-type':'application/json; charset=UTF-8', 'cache-control':'no-store'}
  });
}

function todayStamp(){
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

function makeReceipt(){
  const suffix = crypto.randomUUID().replace(/-/g,'').slice(0,6).toUpperCase();
  return `TUCK-${todayStamp()}-${suffix}`;
}

function basicAuth(keyId, keySecret){
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

async function razorpayFetch(path, env, init={}){
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      'Authorization': basicAuth(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET),
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok){
    const message = data?.error?.description || 'Razorpay API request failed.';
    throw new Error(message);
  }
  return data;
}

function timingSafeEqual(a, b){
  if(a.length !== b.length) return false;
  let result = 0;
  for(let i=0;i<a.length;i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function hex(bytes){
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function hmacSha256(secret, message){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function clean(value, max=256){
  return String(value ?? '').trim().slice(0,max);
}

function validateCustomer(customer){
  if(!customer || typeof customer !== 'object') throw new Error('Customer details are required.');
  const name = clean(customer.name, 100);
  const phone = clean(customer.phone, 10);
  const email = clean(customer.email, 120);
  const address = clean(customer.address, 256);
  const landmark = clean(customer.landmark, 160);
  const city = clean(customer.city, 80);
  const pincode = clean(customer.pincode, 6);
  const state = clean(customer.state, 80);

  if(!name || !/^\d{10}$/.test(phone) || !address || !city || !/^\d{6}$/.test(pincode) || !state){
    throw new Error('Please provide valid delivery details.');
  }
  if(email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please provide a valid email address.');
  return {name, phone, email, address, landmark, city, pincode, state};
}

function validateItems(items){
  if(!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error('Invalid cart.');
  let amount = 0;
  const validated = [];
  for(const raw of items){
    const product = CATALOG[raw?.productId];
    if(!product) throw new Error('One of the products is no longer available.');
    const size = raw?.size ? String(raw.size) : null;
    if(product.requiresSize && !ALLOWED_SIZES.has(size)) throw new Error(`${product.name} requires a valid size.`);
    if(!product.requiresSize && size) throw new Error('Invalid size selection.');
    amount += product.price;
    validated.push({id: raw.productId, name: product.name, price: product.price, size});
  }
  return {amount, items: validated};
}

async function createOrder(request, env){
  const body = await request.json();
  const customer = validateCustomer(body.customer);
  const {amount, items} = validateItems(body.items);
  const receipt = makeReceipt();

  const itemText = items.map(item => `${item.name}${item.size ? ` (${item.size})` : ''} x1`).join(', ').slice(0, 240);
  const notes = {
    customer_name: customer.name,
    phone: customer.phone,
    email: customer.email || 'not-provided',
    address: customer.address,
    landmark: customer.landmark || 'not-provided',
    city: customer.city,
    state: customer.state,
    pincode: customer.pincode,
    items: itemText
  };

  const order = await razorpayFetch('/orders', env, {
    method: 'POST',
    body: JSON.stringify({
      amount: amount * 100,
      currency: 'INR',
      receipt,
      notes
    })
  });

  return json({
    keyId: env.RAZORPAY_KEY_ID,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    receipt
  });
}

async function verifyPayment(request, env){
  const body = await request.json();
  const paymentId = clean(body.razorpay_payment_id, 80);
  const orderId = clean(body.razorpay_order_id, 80);
  const signature = clean(body.razorpay_signature, 128);

  if(!paymentId || !orderId || !signature) throw new Error('Incomplete payment response.');

  // Retrieve the order server-side. Razorpay specifically recommends using the
  // order_id from your server for signature verification rather than trusting
  // the client-supplied order id directly.
  const order = await razorpayFetch(`/orders/${encodeURIComponent(orderId)}`, env, {method:'GET'});
  const expected = await hmacSha256(env.RAZORPAY_KEY_SECRET, `${order.id}|${paymentId}`);
  if(!timingSafeEqual(expected, signature)) return json({error:'Payment signature verification failed.'}, 400);

  const payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}`, env, {method:'GET'});
  if(payment.order_id !== order.id) return json({error:'Payment does not belong to this order.'}, 400);
  if(payment.amount !== order.amount || payment.currency !== order.currency) return json({error:'Payment amount mismatch.'}, 400);
  if(payment.status !== 'captured') return json({error:'Payment is not captured yet. Please check the Razorpay payment status before fulfilling this order.'}, 409);

  return json({ok:true, receipt: order.receipt, paymentId: payment.id, orderId: order.id});
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    if(request.method === 'OPTIONS'){
      return new Response(null, {status:204, headers:{'access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':'Content-Type'}});
    }

    try {
      if(url.pathname === '/api/create-order' && request.method === 'POST') return await createOrder(request, env);
      if(url.pathname === '/api/verify-payment' && request.method === 'POST') return await verifyPayment(request, env);
      return env.ASSETS.fetch(request);
    } catch(error){
      console.error(error);
      return json({error: error?.message || 'Unexpected server error.'}, 400);
    }
  }
};

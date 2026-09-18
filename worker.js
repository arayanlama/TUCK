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


async function inventoryCheck(env, items){
  if(!env.DB) return;
  for(const item of items){
    const keySize = item.size || '';
    const row = await env.DB.prepare('SELECT stock, track_inventory FROM inventory WHERE product_id=? AND size=?').bind(item.id,keySize).first();
    if(row && Number(row.track_inventory)===1 && Number(row.stock)<1) throw new Error(`${item.name}${item.size ? ` (${item.size})` : ''} is out of stock.`);
  }
}
async function inventoryDecrease(env, orderId){
  if(!env.DB) return;
  const items=(await env.DB.prepare('SELECT product_id,size,quantity FROM order_items WHERE order_id=?').bind(orderId).all()).results||[];
  for(const item of items){
    const size=item.size||'';
    const row=await env.DB.prepare('SELECT stock,track_inventory FROM inventory WHERE product_id=? AND size=?').bind(item.product_id,size).first();
    if(row && Number(row.track_inventory)===1){
      const r=await env.DB.prepare('UPDATE inventory SET stock=stock-?, updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND size=? AND stock>=?').bind(Number(item.quantity)||1,item.product_id,size,Number(item.quantity)||1).run();
      if(!r.meta?.changes) throw new Error('Inventory changed while payment was processing. Please contact TUCK support.');
    }
  }
}
async function sendStoreEmail(env, to, subject, html){
  if(!env.RESEND_API_KEY || !env.ORDER_FROM_EMAIL || !to) return {skipped:true};
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.ORDER_FROM_EMAIL,to:[to],subject,html})});
  if(!r.ok) console.error('Email send failed', await r.text());
  return {ok:r.ok};
}

async function createOrder(request, env){
  const body = await request.json();
  const customer = validateCustomer(body.customer);
  const {amount, items} = validateItems(body.items);
  await inventoryCheck(env, items);
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

  // Record checkout server-side as soon as the Razorpay order exists. This is
  // intentionally separate from newsletter subscribers: checkout email is optional.
  if(env.DB){
    const customerResult = await env.DB.prepare(`
      INSERT INTO commerce_customers (name, phone, email, first_order_at, last_order_at)
      VALUES (?, ?, NULLIF(?, ''), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(phone) DO UPDATE SET
        name = excluded.name,
        email = COALESCE(excluded.email, commerce_customers.email),
        last_order_at = CURRENT_TIMESTAMP
      RETURNING id
    `).bind(customer.name, customer.phone, customer.email).first();

    const customerId = Number(customerResult?.id);
    await env.DB.prepare(`
      INSERT INTO orders (
        receipt, razorpay_order_id, customer_id, amount_paise, currency, payment_status, order_status,
        shipping_name, shipping_phone, shipping_email, address, landmark, city, state, pincode
      ) VALUES (?, ?, ?, ?, ?, 'pending', 'placed', ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?)
    `).bind(
      receipt, order.id, customerId, order.amount, order.currency,
      customer.name, customer.phone, customer.email, customer.address, customer.landmark,
      customer.city, customer.state, customer.pincode
    ).run();

    const orderRow = await env.DB.prepare('SELECT id FROM orders WHERE razorpay_order_id = ?').bind(order.id).first();
    const orderDbId = Number(orderRow?.id);
    if(orderDbId){
      await env.DB.batch(items.map(item => env.DB.prepare(
        'INSERT INTO order_items (order_id, product_id, product_name, size, unit_price_paise, quantity) VALUES (?, ?, ?, ?, ?, 1)'
      ).bind(orderDbId, item.id, item.name, item.size, item.price * 100)));
    }
  }

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

  if(env.DB){
    const dbOrder = await env.DB.prepare('SELECT id, shipping_email, shipping_name, receipt, payment_status FROM orders WHERE razorpay_order_id=?').bind(order.id).first();
    if(dbOrder && dbOrder.payment_status !== 'paid'){
      await inventoryDecrease(env, Number(dbOrder.id));
      await env.DB.prepare(`
        UPDATE orders SET payment_status = 'paid', order_status = 'confirmed', razorpay_payment_id = ?, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE razorpay_order_id = ?
      `).bind(payment.id, order.id).run();
      await sendStoreEmail(env, dbOrder.shipping_email, `TUCK order confirmed — ${dbOrder.receipt}`, `<p>Hi ${dbOrder.shipping_name},</p><p>Your TUCK order <strong>${dbOrder.receipt}</strong> is confirmed and paid.</p><p>We’ll email you again when it ships.</p>`);
    }
  }

  return json({ok:true, receipt: order.receipt, paymentId: payment.id, orderId: order.id});
}

async function subscribeNewsletter(request, env){
  if(!env.DB) return json({error:'Newsletter database is not configured yet.'}, 503);
  const body = await request.json().catch(() => ({}));
  const email = clean(body.email, 254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:'Please enter a valid email address.'}, 400);

  const existing = await env.DB.prepare('SELECT subscribed FROM customers WHERE email = ?').bind(email).first();
  if(existing){
    if(Number(existing.subscribed) === 1) return json({ok:true, alreadySubscribed:true, message:'You’re already on the list.'});
    await env.DB.prepare("UPDATE customers SET subscribed = 1, updated_at = CURRENT_TIMESTAMP WHERE email = ?").bind(email).run();
    return json({ok:true, message:'Welcome back — you’re subscribed.'});
  }

  await env.DB.prepare("INSERT INTO customers (email, subscribed, source) VALUES (?, 1, 'website-newsletter')").bind(email).run();
  return json({ok:true, message:'Thanks — you’re on the list.'}, 201);
}


function isAdmin(request, env){
  const token = clean(env.ADMIN_TOKEN, 512);
  if(!token) return false;
  const auth = request.headers.get('Authorization') || '';
  if(!auth.startsWith('Bearer ')) return false;
  return timingSafeEqual(auth.slice(7), token);
}

async function adminCustomers(request, env){
  if(!env.DB) return json({error:'Customer database is not configured.'}, 503);
  if(!isAdmin(request, env)) return json({error:'Unauthorized'}, 401);
  const url = new URL(request.url);
  const q = clean(url.searchParams.get('q'), 120).toLowerCase();
  const status = clean(url.searchParams.get('status'), 20);
  let sql = 'SELECT id, email, subscribed, source, created_at, updated_at FROM customers';
  const where = [];
  const binds = [];
  if(q){ where.push('LOWER(email) LIKE ?'); binds.push(`%${q}%`); }
  if(status === 'subscribed'){ where.push('subscribed = 1'); }
  if(status === 'unsubscribed'){ where.push('subscribed = 0'); }
  if(where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 1000';
  const stmt = env.DB.prepare(sql);
  const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  const stats = await env.DB.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN subscribed = 1 THEN 1 ELSE 0 END) AS subscribed FROM customers').first();
  return json({ok:true, customers:result.results || [], stats:{total:Number(stats?.total||0), subscribed:Number(stats?.subscribed||0)}});
}


async function adminCommerceCustomers(request, env){
  if(!env.DB) return json({error:'Customer database is not configured.'}, 503);
  if(!isAdmin(request, env)) return json({error:'Unauthorized'}, 401);
  const result = await env.DB.prepare(`
    SELECT c.id, c.name, c.phone, c.email, c.first_order_at, c.last_order_at,
           COUNT(o.id) AS order_count,
           COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.amount_paise ELSE 0 END),0) AS paid_paise
    FROM commerce_customers c LEFT JOIN orders o ON o.customer_id=c.id
    GROUP BY c.id ORDER BY c.last_order_at DESC LIMIT 1000
  `).all();
  return json({ok:true, customers:result.results || []});
}

async function adminOrders(request, env){
  if(!env.DB) return json({error:'Order database is not configured.'}, 503);
  if(!isAdmin(request, env)) return json({error:'Unauthorized'}, 401);
  const result = await env.DB.prepare(`
    SELECT o.id, o.receipt, o.razorpay_order_id, o.razorpay_payment_id, o.amount_paise, o.currency,
           o.payment_status, o.order_status, o.shipping_name, o.shipping_phone, o.shipping_email,
           o.address, o.landmark, o.city, o.state, o.pincode, o.created_at, o.paid_at, o.courier, o.tracking_number, o.tracking_url, o.shipped_at, o.delivered_at,
           GROUP_CONCAT(oi.product_name || CASE WHEN oi.size IS NOT NULL THEN ' (' || oi.size || ')' ELSE '' END, ', ') AS items
    FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
    GROUP BY o.id ORDER BY o.id DESC LIMIT 1000
  `).all();
  const stats = await env.DB.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN payment_status='paid' THEN 1 ELSE 0 END) paid, COALESCE(SUM(CASE WHEN payment_status='paid' THEN amount_paise ELSE 0 END),0) revenue_paise FROM orders`).first();
  return json({ok:true, orders:result.results || [], stats:{total:Number(stats?.total||0), paid:Number(stats?.paid||0), revenue_paise:Number(stats?.revenue_paise||0)}});
}

async function adminSetSubscription(request, env){
  if(!env.DB) return json({error:'Customer database is not configured.'}, 503);
  if(!isAdmin(request, env)) return json({error:'Unauthorized'}, 401);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const subscribed = body.subscribed ? 1 : 0;
  if(!Number.isInteger(id) || id < 1) return json({error:'Invalid customer.'}, 400);
  await env.DB.prepare('UPDATE customers SET subscribed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(subscribed, id).run();
  return json({ok:true});
}


async function adminInventory(request, env){
  if(!env.DB) return json({error:'Database is not configured.'},503); if(!isAdmin(request,env)) return json({error:'Unauthorized'},401);
  if(request.method==='GET'){
    const rows=(await env.DB.prepare('SELECT product_id,size,stock,low_stock_threshold,track_inventory,updated_at FROM inventory ORDER BY product_id,size').all()).results||[];
    const map=new Map(rows.map(r=>[`${r.product_id}|${r.size}`,r]));
    const out=[]; for(const [id,p] of Object.entries(CATALOG)){ const sizes=p.requiresSize?['S','M','L']:['']; for(const size of sizes){out.push(map.get(`${id}|${size}`)||{product_id:id,size,stock:0,low_stock_threshold:3,track_inventory:0,product_name:p.name});} }
    out.forEach(r=>r.product_name=CATALOG[r.product_id]?.name||r.product_id); return json({ok:true,inventory:out});
  }
  const b=await request.json(); const id=clean(b.product_id,80), size=clean(b.size,8), stock=Math.max(0,Math.floor(Number(b.stock)||0)), threshold=Math.max(0,Math.floor(Number(b.low_stock_threshold)||0)), track=b.track_inventory?1:0;
  if(!CATALOG[id]) return json({error:'Invalid product.'},400);
  await env.DB.prepare(`INSERT INTO inventory(product_id,size,stock,low_stock_threshold,track_inventory) VALUES(?,?,?,?,?) ON CONFLICT(product_id,size) DO UPDATE SET stock=excluded.stock,low_stock_threshold=excluded.low_stock_threshold,track_inventory=excluded.track_inventory,updated_at=CURRENT_TIMESTAMP`).bind(id,size,stock,threshold,track).run(); return json({ok:true});
}
async function adminOrderUpdate(request, env){
  if(!env.DB) return json({error:'Database is not configured.'},503); if(!isAdmin(request,env)) return json({error:'Unauthorized'},401);
  const b=await request.json(); const id=Number(b.id); if(!Number.isInteger(id)||id<1) return json({error:'Invalid order.'},400);
  const allowed=new Set(['placed','confirmed','processing','shipped','delivered','cancelled','refunded']); const status=clean(b.order_status,30); if(!allowed.has(status)) return json({error:'Invalid status.'},400);
  const courier=clean(b.courier,80), tracking=clean(b.tracking_number,120), trackingUrl=clean(b.tracking_url,500);
  const before=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first(); if(!before) return json({error:'Order not found.'},404);
  await env.DB.prepare(`UPDATE orders SET order_status=?,courier=NULLIF(?,''),tracking_number=NULLIF(?,''),tracking_url=NULLIF(?,''),shipped_at=CASE WHEN ?='shipped' AND shipped_at IS NULL THEN CURRENT_TIMESTAMP ELSE shipped_at END,delivered_at=CASE WHEN ?='delivered' AND delivered_at IS NULL THEN CURRENT_TIMESTAMP ELSE delivered_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,courier,tracking,trackingUrl,status,status,id).run();
  if(status==='shipped' && before.order_status!=='shipped') await sendStoreEmail(env,before.shipping_email,`TUCK order shipped — ${before.receipt}`,`<p>Hi ${before.shipping_name},</p><p>Your TUCK order <strong>${before.receipt}</strong> has shipped${courier?` via ${courier}`:''}.</p>${tracking?`<p>Tracking: ${tracking}</p>`:''}${trackingUrl?`<p><a href="${trackingUrl}">Track your order</a></p>`:''}`);
  if(status==='delivered' && before.order_status!=='delivered') await sendStoreEmail(env,before.shipping_email,`TUCK order delivered — ${before.receipt}`,`<p>Hi ${before.shipping_name},</p><p>Your TUCK order <strong>${before.receipt}</strong> has been marked delivered. Thank you.</p>`);
  return json({ok:true});
}
async function adminOrderNotes(request, env){
  if(!env.DB) return json({error:'Database is not configured.'},503); if(!isAdmin(request,env)) return json({error:'Unauthorized'},401);
  const url=new URL(request.url); if(request.method==='GET'){const id=Number(url.searchParams.get('order_id')); const r=await env.DB.prepare('SELECT id,note,created_at FROM order_notes WHERE order_id=? ORDER BY id DESC').bind(id).all(); return json({ok:true,notes:r.results||[]});}
  const b=await request.json(); const id=Number(b.order_id), note=clean(b.note,1000); if(!id||!note)return json({error:'Order and note required.'},400); await env.DB.prepare('INSERT INTO order_notes(order_id,note) VALUES(?,?)').bind(id,note).run(); return json({ok:true});
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    if(request.method === 'OPTIONS'){
      return new Response(null, {status:204, headers:{'access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':'Content-Type'}});
    }

    try {
      if(url.pathname === '/api/newsletter/subscribe' && request.method === 'POST') return await subscribeNewsletter(request, env);
      if(url.pathname === '/api/admin/customers' && request.method === 'GET') return await adminCustomers(request, env);
      if(url.pathname === '/api/admin/commerce-customers' && request.method === 'GET') return await adminCommerceCustomers(request, env);
      if(url.pathname === '/api/admin/orders' && request.method === 'GET') return await adminOrders(request, env);
      if(url.pathname === '/api/admin/customer-subscription' && request.method === 'POST') return await adminSetSubscription(request, env);
      if(url.pathname === '/api/admin/inventory' && (request.method === 'GET' || request.method === 'POST')) return await adminInventory(request, env);
      if(url.pathname === '/api/admin/order-update' && request.method === 'POST') return await adminOrderUpdate(request, env);
      if(url.pathname === '/api/admin/order-notes' && (request.method === 'GET' || request.method === 'POST')) return await adminOrderNotes(request, env);
      if(url.pathname === '/api/create-order' && request.method === 'POST') return await createOrder(request, env);
      if(url.pathname === '/api/verify-payment' && request.method === 'POST') return await verifyPayment(request, env);
      return env.ASSETS.fetch(request);
    } catch(error){
      console.error(error);
      return json({error: error?.message || 'Unexpected server error.'}, 400);
    }
  }
};

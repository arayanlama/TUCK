const cart = [];
const cartEl = document.getElementById('cart');
const overlay = document.getElementById('overlay');
const cartCount = document.getElementById('cartCount');
const cartItems = document.getElementById('cartItems');
const cartTotal = document.getElementById('cartTotal');
const cartButton = document.getElementById('cartButton');
const checkoutButton = document.getElementById('checkout');
let lastFocusedElement = null;
let paymentInProgress = false;

const checkoutPage = document.getElementById('checkoutPage');
const checkoutFormView = document.getElementById('checkoutFormView');
const checkoutConfirmView = document.getElementById('checkoutConfirmView');
const orderForm = document.getElementById('orderForm');
const orderSummaryList = document.getElementById('orderSummaryList');
const orderRef = document.getElementById('orderRef');
const orderRecap = document.getElementById('orderRecap');
const completePurchaseBtn = document.getElementById('completePurchase');
const addLandmarkBtn = document.getElementById('addLandmarkBtn');
const landmarkField = document.getElementById('landmarkField');

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatINR(amount){
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function cartLineHtml(item, withRemove, index){
  const quantity=Number(item.quantity)||1;
  const removeHtml = withRemove ? `<div class="cart-actions"><div class="quantity" aria-label="Quantity for ${escapeHtml(item.name)}"><button type="button" data-quantity-index="${index}" data-quantity-change="-1" aria-label="Decrease quantity">−</button><span>${quantity}</span><button type="button" data-quantity-index="${index}" data-quantity-change="1" aria-label="Increase quantity">+</button></div><button class="remove" type="button" data-remove-index="${index}" aria-label="Remove ${escapeHtml(item.name)} from cart">Remove</button></div>` : `<span class="cart-quantity">×${quantity}</span>`;
  const thumbHtml = item.img
    ? `<img class="cart-thumb" src="${escapeHtml(item.img)}" alt="" loading="lazy">`
    : `<span class="cart-thumb cart-thumb-empty" aria-hidden="true"></span>`;
  const meta = item.size ? ` · Size ${escapeHtml(item.size)}` : '';
  return `
      <div class="cart-row">
        ${thumbHtml}
        <span class="cart-row-label">${escapeHtml(item.name)}${meta}</span>
        <strong>${formatINR(item.price * quantity)}</strong>
        ${removeHtml}
      </div>`;
}

function getCartTotal(){
  return cart.reduce((sum, item) => sum + Number(item.price || 0)*(Number(item.quantity)||1), 0);
}

function getCartUnitCount(){ return cart.reduce((sum,item)=>sum+(Number(item.quantity)||1),0); }

function renderCart(){
  cartCount.textContent = getCartUnitCount();
  if(!cart.length){
    cartItems.innerHTML = '<p class="empty">Your cart is empty.</p>';
  } else {
    cartItems.innerHTML = cart.map((item,i) => cartLineHtml(item, true, i)).join('');
  }
  cartTotal.textContent = formatINR(getCartTotal());
  checkoutButton.disabled = cart.length === 0;
}
function removeItem(i){ cart.splice(i,1); renderCart(); }

function openCart(){ lastFocusedElement=document.activeElement; cartEl.inert=false; cartEl.classList.add('open'); overlay.classList.add('show'); cartEl.setAttribute('aria-hidden','false'); cartButton.setAttribute('aria-expanded','true'); document.getElementById('closeCart').focus(); }
function closeCart(){ cartEl.classList.remove('open'); overlay.classList.remove('show'); cartEl.setAttribute('aria-hidden','true'); cartEl.inert=true; cartButton.setAttribute('aria-expanded','false'); if(lastFocusedElement?.focus)lastFocusedElement.focus(); }

const checkoutSteps = document.querySelectorAll('.checkout-step');
function setCheckoutStep(step){
  checkoutSteps.forEach(s=>{
    s.classList.remove('active','complete');
    if(s.dataset.step === step) s.classList.add('active');
    else if(step === 'confirmation' && s.dataset.step === 'details') s.classList.add('complete');
  });
}

function openCheckout(){
  checkoutConfirmView.classList.add('hidden');
  checkoutFormView.classList.remove('hidden');
  checkoutPage.classList.remove('hidden');
  setCheckoutStep('details');
  document.body.style.overflow = 'hidden';
  closeCart();
  checkoutPage.querySelector('input,button,select,textarea')?.focus();
}
function closeCheckout(){
  if(paymentInProgress){ alert('Your payment is still being processed. Please wait for Razorpay to finish.'); return; }
  checkoutPage.classList.add('hidden');
  document.body.style.overflow = '';
}

function setPaymentInProgress(active){
  paymentInProgress=active;
  document.getElementById('checkoutClose').disabled=active;
}

cartButton.onclick = openCart;
document.getElementById('closeCart').onclick = closeCart;
overlay.onclick = closeCart;
document.getElementById('checkoutClose').onclick = closeCheckout;
document.getElementById('continueShopping').onclick = closeCheckout;
cartItems.addEventListener('click',event=>{
  const button=event.target.closest('[data-remove-index]');
  if(button){ removeItem(Number(button.dataset.removeIndex)); return; }
  const quantityButton=event.target.closest('[data-quantity-index]');
  if(!quantityButton)return;
  const index=Number(quantityButton.dataset.quantityIndex),change=Number(quantityButton.dataset.quantityChange),item=cart[index];
  if(!item)return;
  if(change>0&&getCartUnitCount()>=20){ alert('Your cart can contain up to 20 units per order.'); return; }
  item.quantity=(Number(item.quantity)||1)+change;
  if(item.quantity<1) cart.splice(index,1);
  renderCart();
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape') return;
  if(!checkoutPage.classList.contains('hidden')) closeCheckout();
  else if(cartEl.classList.contains('open')) closeCart();
});

addLandmarkBtn.addEventListener('click', () => {
  landmarkField.classList.remove('hidden');
  addLandmarkBtn.classList.add('hidden');
  document.getElementById('ofLandmark').focus();
});

function updateCompletePurchaseState(){
  completePurchaseBtn.disabled = !orderForm.checkValidity() || cart.length === 0;
}
orderForm.addEventListener('input', updateCompletePurchaseState);
orderForm.addEventListener('change', updateCompletePurchaseState);

document.querySelectorAll('.size-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const group = btn.closest('.size-options');
    group.querySelectorAll('.size-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.querySelectorAll('.add').forEach(btn=>{
  btn.addEventListener('click',()=>{
    if(btn.disabled) return;
    const article = btn.closest('.product');
    const activeSize = article.querySelector('.size-btn.active');
    const productImg = article.querySelector('.product-image img');
    const price = Number(article.dataset.price);
    const productId = btn.dataset.productId;

    if(!productId || !Number.isFinite(price) || price <= 0){
      alert('This product is not available for online purchase yet.');
      return;
    }

    if(getCartUnitCount()>=20){ alert('Your cart can contain up to 20 units per order.'); return; }
    if(article.querySelector('.size-options')&&!activeSize){ alert('Please choose a size.'); return; }
    const existing=cart.find(item=>item.productId===productId&&(item.size||null)===(activeSize?.dataset.size||null));
    if(existing){ existing.quantity=(Number(existing.quantity)||1)+1; renderCart(); openCart(); return; }
    const item = {
      productId,
      name: btn.dataset.name,
      price,
      size: activeSize ? activeSize.dataset.size : null,
      img: productImg ? productImg.getAttribute('src') : '',
      quantity: 1
    };

    cart.push(item);
    renderCart();
    openCart();

    const originalText = btn.textContent;
    btn.classList.add('added');
    btn.textContent = 'Added ✓';
    setTimeout(()=>{ btn.classList.remove('added'); btn.textContent = originalText; }, 1400);
  });
});

document.querySelectorAll('.filter').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.filter').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const f=btn.dataset.filter;
    document.querySelectorAll('.product').forEach(p=>{
      p.style.display=(f==='all'||p.dataset.category===f)?'':'none';
    });
  });
});

document.querySelectorAll('.thumb').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const article = btn.closest('.product');
    const mainImg = article.querySelector('.main-img');
    mainImg.src = btn.dataset.src;
    article.querySelectorAll('.thumb').forEach(t=>t.classList.remove('active'));
    btn.classList.add('active');
  });
});

const orderSummaryHeading = document.getElementById('orderSummaryHeading');

document.getElementById('checkout').onclick = () => {
  if(!cart.length){ alert('Your cart is empty.'); return; }
  orderSummaryList.innerHTML = cart.map(item => cartLineHtml(item, false)).join('') +
    `<div class="cart-row"><span class="cart-row-label"><strong>Total</strong></span><strong>${formatINR(getCartTotal())}</strong></div>`;
  if(orderSummaryHeading){
    const units=getCartUnitCount();
    orderSummaryHeading.textContent = `Order summary (${units} unit${units!==1?'s':''})`;
  }
  openCheckout();
  updateCompletePurchaseState();
};

function resetCheckoutForm(){
  orderForm.reset();
  landmarkField.classList.add('hidden');
  addLandmarkBtn.classList.remove('hidden');
  updateCompletePurchaseState();
}

function formDataObject(){
  const data = new FormData(orderForm);
  return Object.fromEntries(data.entries());
}

async function createRazorpayOrder(customer){
  const response = await fetch('/api/create-order', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      customer,
      items: cart.map(item => ({ productId: item.productId, size: item.size, quantity: item.quantity }))
    })
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || 'Could not create the payment order.');
  return data;
}

async function verifyPayment(paymentResponse, receipt){
  const response = await fetch('/api/verify-payment', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ ...paymentResponse, receipt })
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || 'Payment verification failed.');
  return data;
}

function showConfirmation(receipt, paymentId){
  orderRef.textContent = receipt;
  orderRecap.innerHTML = cart.map(item => cartLineHtml(item, false)).join('') +
    `<div class="cart-row"><span class="cart-row-label"><strong>Paid</strong></span><strong>${formatINR(getCartTotal())}</strong></div>`;
  const paymentNote = document.getElementById('paymentIdNote');
  if(paymentNote) paymentNote.textContent = paymentId ? `Payment ID: ${paymentId}` : '';

  cart.length = 0;
  renderCart();
  resetCheckoutForm();
  checkoutFormView.classList.add('hidden');
  checkoutConfirmView.classList.remove('hidden');
  checkoutPage.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setCheckoutStep('confirmation');
  checkoutPage.scrollTop = 0;
}

orderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if(!orderForm.checkValidity()){
    orderForm.reportValidity();
    return;
  }
  if(!cart.length){
    alert('Your cart is empty.');
    return;
  }
  if(typeof Razorpay === 'undefined'){
    alert('Razorpay could not load. Please check your connection and try again.');
    return;
  }

  setPaymentInProgress(true);
  completePurchaseBtn.disabled = true;
  completePurchaseBtn.textContent = 'Preparing payment…';

  try {
    const customer = formDataObject();
    const order = await createRazorpayOrder(customer);

    const options = {
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'TUCK',
      description: `TUCK order ${order.receipt}`,
      image: `${window.location.origin}/assets/logo.jpg`,
      order_id: order.orderId,
      prefill: {
        name: customer.name,
        email: customer.email || '',
        contact: customer.phone
      },
      notes: {order_reference: order.receipt},
      theme: {color: '#111111'},
      handler: async function(paymentResponse){
        completePurchaseBtn.textContent = 'Verifying payment…';
        try {
          const verified = await verifyPayment(paymentResponse, order.receipt);
          setPaymentInProgress(false);
          showConfirmation(verified.receipt || order.receipt, paymentResponse.razorpay_payment_id);
        } catch(error) {
          console.error(error);
          setPaymentInProgress(false);
          completePurchaseBtn.disabled = false;
          completePurchaseBtn.textContent = 'Pay securely with Razorpay';
          alert(error.message || 'We could not verify the payment. Please do not retry repeatedly; check your Razorpay Dashboard or contact TUCK.');
        }
      },
      modal: {
        ondismiss: function(){
          setPaymentInProgress(false);
          completePurchaseBtn.disabled = false;
          completePurchaseBtn.textContent = 'Pay securely with Razorpay';
        }
      }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function(response){
      console.error('Razorpay payment failed', response.error);
      setPaymentInProgress(false);
      completePurchaseBtn.disabled = false;
      completePurchaseBtn.textContent = 'Pay securely with Razorpay';
      alert(response.error?.description || 'Payment failed. Please try again.');
    });
    rzp.open();
  } catch(error) {
    console.error(error);
    setPaymentInProgress(false);
    completePurchaseBtn.disabled = false;
    completePurchaseBtn.textContent = 'Pay securely with Razorpay';
    alert(error.message || 'Unable to start payment. Please try again.');
  }
});

cartEl.inert=true;
renderCart();


// Newsletter signup -> Cloudflare Worker -> D1
const newsletterForm = document.getElementById('newsletterForm');
if(newsletterForm){
  const newsletterEmail = document.getElementById('newsletterEmail');
  const newsletterJoin = document.getElementById('newsletterJoin');
  const newsletterStatus = document.getElementById('newsletterStatus');

  newsletterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    newsletterStatus.className = 'newsletter-status';
    if(!newsletterEmail.checkValidity()){
      newsletterEmail.reportValidity();
      return;
    }
    newsletterJoin.disabled = true;
    newsletterJoin.textContent = 'Joining…';
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({email: newsletterEmail.value})
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok) throw new Error(data.error || 'Could not subscribe right now.');
      newsletterStatus.textContent = data.message || 'Thanks — you’re on the list.';
      newsletterStatus.classList.add('success');
      newsletterForm.reset();
    } catch(error) {
      console.error(error);
      newsletterStatus.textContent = location.protocol === 'file:'
        ? 'Newsletter signup works after the site is deployed through Cloudflare.'
        : (error.message || 'Could not subscribe right now. Please try again.');
      newsletterStatus.classList.add('error');
    } finally {
      newsletterJoin.disabled = false;
      newsletterJoin.textContent = 'Join';
    }
  });
}

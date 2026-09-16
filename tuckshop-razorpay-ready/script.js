const cart = [];
const cartEl = document.getElementById('cart');
const overlay = document.getElementById('overlay');
const cartCount = document.getElementById('cartCount');
const cartItems = document.getElementById('cartItems');
const cartTotal = document.getElementById('cartTotal');

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
  const removeHtml = withRemove ? `<button class="remove" onclick="removeItem(${index})">Remove</button>` : '';
  const thumbHtml = item.img
    ? `<img class="cart-thumb" src="${escapeHtml(item.img)}" alt="" loading="lazy">`
    : `<span class="cart-thumb cart-thumb-empty" aria-hidden="true"></span>`;
  const meta = item.size ? ` · Size ${escapeHtml(item.size)}` : '';
  return `
      <div class="cart-row">
        ${thumbHtml}
        <span class="cart-row-label">${escapeHtml(item.name)}${meta}</span>
        <strong>${formatINR(item.price)}</strong>
        ${removeHtml}
      </div>`;
}

function getCartTotal(){
  return cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
}

function renderCart(){
  cartCount.textContent = cart.length;
  if(!cart.length){
    cartItems.innerHTML = '<p class="empty">Your cart is empty.</p>';
  } else {
    cartItems.innerHTML = cart.map((item,i) => cartLineHtml(item, true, i)).join('');
  }
  cartTotal.textContent = formatINR(getCartTotal());
}
function removeItem(i){ cart.splice(i,1); renderCart(); }

function openCart(){ cartEl.classList.add('open'); overlay.classList.add('show'); }
function closeCart(){ cartEl.classList.remove('open'); overlay.classList.remove('show'); }

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
}
function closeCheckout(){
  checkoutPage.classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('cartButton').onclick = openCart;
document.getElementById('closeCart').onclick = closeCart;
overlay.onclick = closeCart;
document.getElementById('checkoutClose').onclick = closeCheckout;
document.getElementById('continueShopping').onclick = closeCheckout;

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

    const item = {
      productId,
      name: btn.dataset.name,
      price,
      size: activeSize ? activeSize.dataset.size : null,
      img: productImg ? productImg.getAttribute('src') : ''
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
    orderSummaryHeading.textContent = `Order summary (${cart.length} item${cart.length!==1?'s':''})`;
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
      items: cart.map(item => ({ productId: item.productId, size: item.size }))
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
          showConfirmation(verified.receipt || order.receipt, paymentResponse.razorpay_payment_id);
        } catch(error) {
          console.error(error);
          completePurchaseBtn.disabled = false;
          completePurchaseBtn.textContent = 'Pay securely with Razorpay';
          alert(error.message || 'We could not verify the payment. Please do not retry repeatedly; check your Razorpay Dashboard or contact TUCK.');
        }
      },
      modal: {
        ondismiss: function(){
          completePurchaseBtn.disabled = false;
          completePurchaseBtn.textContent = 'Pay securely with Razorpay';
        }
      }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function(response){
      console.error('Razorpay payment failed', response.error);
      completePurchaseBtn.disabled = false;
      completePurchaseBtn.textContent = 'Pay securely with Razorpay';
      alert(response.error?.description || 'Payment failed. Please try again.');
    });
    rzp.open();
  } catch(error) {
    console.error(error);
    completePurchaseBtn.disabled = false;
    completePurchaseBtn.textContent = 'Pay securely with Razorpay';
    alert(error.message || 'Unable to start payment. Please try again.');
  }
});

renderCart();

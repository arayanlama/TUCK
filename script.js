const cart = [];
const cartEl = document.getElementById('cart');
const overlay = document.getElementById('overlay');
const cartCount = document.getElementById('cartCount');
const cartItems = document.getElementById('cartItems');
const cartTotal = document.getElementById('cartTotal');

function renderCart(){
  cartCount.textContent = cart.length;
  if(!cart.length){
    cartItems.innerHTML = '<p class="empty">Your cart is empty.</p>';
  } else {
    cartItems.innerHTML = cart.map((item,i)=>`
      <div class="cart-row">
        <span>${item}</span>
        <button class="remove" onclick="removeItem(${i})">Remove</button>
      </div>`).join('');
  }
  cartTotal.textContent = cart.length;
}
function removeItem(i){ cart.splice(i,1); renderCart(); }
function openCart(){ cartEl.classList.add('open'); overlay.classList.add('show'); }
function closeCart(){ cartEl.classList.remove('open'); overlay.classList.remove('show'); }

document.getElementById('cartButton').onclick=openCart;
document.getElementById('closeCart').onclick=closeCart;
overlay.onclick=closeCart;

document.querySelectorAll('.add').forEach(btn=>{
  btn.addEventListener('click',()=>{
    cart.push(btn.dataset.name);
    renderCart();
    openCart();
  });
});

document.querySelectorAll('.filter').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.filter').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const f=btn.dataset.filter;
    document.querySelectorAll('.product').forEach(p=>{
      p.style.display=(f==='all'||p.dataset.category===f)?'block':'none';
    });
  });
});

document.getElementById('checkout').onclick=()=>{
  if(!cart.length){ alert('Your cart is empty.'); return; }
  alert('Checkout is the next step: we will connect your payment gateway and order notifications.');
};
renderCart();

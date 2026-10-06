(function () {
  'use strict';

  const root = document.getElementById('welcome-screen');
  if (!root) return;
  document.body.classList.add('welcome-visible');
  root.classList.add('is-home');

  const STORAGE_KEY = 'timeless-strips-reviews-v1';
  const sampleReviews = [
    { name: 'Sample guest', rating: 5, feedback: 'Quick and fun. The lilac frame looks so good on the strip.', sample: true },
    { name: 'Sample guest', rating: 4, feedback: 'Loved the four poses. Would like a longer countdown.', sample: true },
    { name: 'Sample guest', rating: 5, feedback: 'The GIF was my favorite part. Sent it straight to the group chat.', sample: true }
  ];
  const pageButtons = root.querySelectorAll('[data-page]');
  const pagePanels = root.querySelectorAll('[data-page-panel]');
  const navButtons = root.querySelectorAll('.site-nav-link[data-page]');
  const startButton = document.getElementById('start-btn');
  const formatButtons = root.querySelectorAll('[data-format]');
  const priceContent = root.querySelector('[data-pricing-content]');
  const gifMessage = root.querySelector('[data-gif-message]');
  const reviewForm = document.getElementById('review-form');
  const reviewStatus = document.getElementById('review-status');
  const ratingHint = document.getElementById('rating-hint');
  const ratingButtons = root.querySelectorAll('[data-rating]');
  const reviewList = document.getElementById('review-list');
  let selectedRating = 0;
  let reviews = [];

  function showPage(pageName) {
    root.classList.toggle('is-home', pageName === 'home');
    pagePanels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.pagePanel !== pageName);
    });
    navButtons.forEach((button) => {
      const active = button.dataset.page === pageName;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  window.addEventListener('booth-home', () => showPage('home'));

  pageButtons.forEach((button) => {
    button.addEventListener('click', () => showPage(button.dataset.page));
  });

  root.querySelectorAll('[data-start-booth]').forEach((button) => {
    button.addEventListener('click', () => {
      showPage('home');
      document.body.classList.remove('welcome-visible');
      startButton.click();
    });
  });
  startButton.addEventListener('click', () => document.body.classList.remove('welcome-visible'));

  formatButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const showGifs = button.dataset.format === 'gifs';
      root.querySelectorAll('.format-button').forEach((tab) => {
        const active = tab.dataset.format === button.dataset.format;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-pressed', String(active));
      });
      priceContent.classList.toggle('hidden', showGifs);
      gifMessage.classList.toggle('hidden', !showGifs);
    });
  });

  const planDialog = document.getElementById('plan-payment-dialog');
  const planLabels = {
    single_strip: 'Single Strip · ₱15',
    double_strip: 'Double Strip · ₱25',
    quad_gif: 'Quad Pack + GIF · ₱50',
    monthly_pass: 'Monthly Pass · ₱150'
  };
  let activePlanId = '';
  let activeOrderId = '';
  let planCheckoutToken = 0;
  const planTitle = document.getElementById('plan-payment-title');
  const planProduct = document.getElementById('plan-payment-product');
  const planMessage = document.getElementById('plan-payment-message');
  const planIcon = document.getElementById('plan-payment-icon');
  const planCheckButton = document.getElementById('plan-payment-check');
  const planRetryButton = document.getElementById('plan-payment-retry');

  function setPlanState(icon, title, message, actions) {
    planIcon.textContent = icon;
    planTitle.textContent = title;
    planMessage.textContent = message;
    planCheckButton.classList.toggle('hidden', !actions.check);
    planRetryButton.classList.toggle('hidden', !actions.retry);
  }

  function showPlanDialog() {
    if (!planDialog.open) planDialog.showModal();
  }

  function startPaidBooth() {
    if (planDialog.open) planDialog.close();
    showPage('home');
    document.body.classList.remove('welcome-visible');
    startButton.click();
  }

  async function monitorPlanPayment(orderId, token) {
    let connectionFailures = 0;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (token !== planCheckoutToken) return;
      try {
        const status = await PaySystem.paymentStatus(orderId);
        connectionFailures = 0;
        if (status.status === 'paid') {
          if (status.plan_id !== activePlanId) {
            console.error('Confirmed payment does not match the selected plan.');
            setPlanState('⚠️', 'Payment needs staff help', 'The confirmed payment does not match this selection. Keep the receipt and ask booth staff before checking out again.', {});
            return;
          }
          const extra = status.plan_id === 'quad_gif'
            ? ' Four strips and one GIF are ready.'
            : status.plan_id === 'monthly_pass'
              ? ' Unlimited strip and GIF saves are active for 30 days.'
              : ' Your strip credits are ready.';
          setPlanState('✅', 'Payment confirmed!', (status.product_name || planLabels[activePlanId]) + ' is paid.' + extra + ' Opening the booth…', {});
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (token === planCheckoutToken) startPaidBooth();
          return;
        }
        if (status.status === 'pending' && status.payment_attempt_status === 'failed') {
          setPlanState('❌', 'Payment declined', 'Payment failed. Your GCash payment was declined. You can retry the same secure checkout without creating another order.', { check: true, retry: true });
          return;
        }
        if (status.status === 'failed') {
          setPlanState('❌', 'Payment declined', 'Payment failed. Your GCash payment was declined. Please choose your plan again to retry.', { retry: true });
          return;
        }
        if (status.status === 'expired') {
          setPlanState('⌛', 'Checkout timed out', 'Payment did not complete before checkout expired. Please try again.', { retry: true });
          return;
        }
      } catch (error) {
        console.error('Could not check plan payment status:', error);
        connectionFailures += 1;
        if (connectionFailures >= 4) {
          setPlanState('📶', 'Connection issue', 'Connection issue, please retry. If you already paid, check the payment status before starting another checkout.', { check: true });
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (token === planCheckoutToken) {
      setPlanState('⌛', 'Payment confirmation timed out', 'Payment did not complete in time. If you paid, check the status again or reopen the same checkout before trying to pay again.', { check: true, retry: true });
    }
  }

  function startPlanCheckout(planId) {
    activePlanId = planId;
    activeOrderId = '';
    planProduct.textContent = planLabels[planId] || 'Selected photobooth plan';
    showPlanDialog();
    if (!PaySystem.configured()) {
      setPlanState('⚠️', 'Payments unavailable', 'The secure payment service is not configured on this booth yet. You can still use Start for free.', { retry: false });
      return;
    }

    const checkoutWindow = window.open('about:blank', '_blank');
    if (!checkoutWindow) {
      setPlanState('⚠️', 'Checkout window blocked', 'Allow pop-ups for this booth to open secure PayMongo GCash checkout, then try again.', { retry: true });
      return;
    }
    checkoutWindow.opener = null;
    planRetryButton.disabled = true;
    setPlanState('✨', 'Starting your checkout', 'Connecting securely to PayMongo…', {});
    const token = ++planCheckoutToken;
    PaySystem.createPlanCheckout(planId).then((result) => {
      if (!result.checkout_url || !result.order_id) throw new Error('PayMongo did not return a checkout link.');
      activeOrderId = result.order_id;
      checkoutWindow.location.replace(result.checkout_url);
      setPlanState('💳', 'Complete payment in GCash', 'Finish the secure payment in the PayMongo tab. This page will verify it and start your booth automatically.', {});
      monitorPlanPayment(result.order_id, token);
    }).catch((error) => {
      console.error('Could not start plan checkout:', error);
      checkoutWindow.close();
      const networkError = !navigator.onLine || /network|fetch|connection/i.test(error.message || '');
      setPlanState(networkError ? '📶' : '⚠️',
        networkError ? 'Connection issue' : 'Checkout could not start',
        networkError ? 'Connection issue, please retry.' : (error.message || 'Payment could not start. Please try again.'),
        { retry: true });
    }).finally(() => {
      planRetryButton.disabled = false;
    });
  }

  root.querySelectorAll('[data-plan-id]').forEach((button) => {
    button.addEventListener('click', () => startPlanCheckout(button.dataset.planId));
  });
  planRetryButton.addEventListener('click', () => {
    if (activePlanId) startPlanCheckout(activePlanId);
  });
  planCheckButton.addEventListener('click', () => {
    if (!activeOrderId) return;
    const token = ++planCheckoutToken;
    setPlanState('⏳', 'Checking payment status', 'Checking securely with PayMongo…', {});
    monitorPlanPayment(activeOrderId, token);
  });
  document.getElementById('plan-payment-close').addEventListener('click', () => planDialog.close());

  function loadReviews() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(saved) || !saved.every((review) =>
        review && typeof review.name === 'string' &&
        typeof review.feedback === 'string' &&
        Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5
      )) {
        throw new Error('Saved reviews have an invalid format.');
      }
      reviews = saved;
    } catch (error) {
      reviews = [];
      reviewStatus.textContent = 'Saved feedback could not be loaded. New feedback can still be submitted.';
      console.error('Unable to load saved feedback:', error);
    }
  }

  function renderReviews() {
    const allReviews = reviews.slice().reverse().concat(sampleReviews);
    const total = allReviews.length;
    const average = allReviews.reduce((sum, review) => sum + review.rating, 0) / total;
    const averageText = average.toFixed(1);
    document.getElementById('average-rating').textContent = averageText;
    document.getElementById('average-stars').setAttribute('aria-label', averageText + ' out of 5 stars');
    document.getElementById('rating-count').textContent = total + (total === 1 ? ' rating' : ' ratings');

    const bars = document.getElementById('rating-bars');
    bars.replaceChildren();
    for (let rating = 5; rating >= 1; rating -= 1) {
      const count = allReviews.filter((review) => review.rating === rating).length;
      const row = document.createElement('div');
      row.className = 'rating-row';
      row.setAttribute('aria-label', rating + ' stars: ' + count);
      const label = document.createElement('span');
      label.textContent = String(rating);
      const track = document.createElement('span');
      track.className = 'rating-track';
      const fill = document.createElement('span');
      fill.className = 'rating-fill';
      fill.style.display = 'block';
      fill.style.width = (count / total * 100) + '%';
      track.append(fill);
      const number = document.createElement('span');
      number.textContent = String(count);
      row.append(label, track, number);
      bars.append(row);
    }

    reviewList.replaceChildren();
    allReviews.slice(0, 5).forEach((review) => {
      const card = document.createElement('article');
      card.className = 'review-card';
      const avatar = document.createElement('span');
      avatar.className = 'review-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = (review.name.trim()[0] || 'G').toUpperCase();
      const content = document.createElement('div');
      const meta = document.createElement('div');
      meta.className = 'review-meta';
      const name = document.createElement('span');
      name.textContent = review.name || 'Guest';
      meta.append(name);
      if (review.sample) {
        const badge = document.createElement('span');
        badge.className = 'sample-tag';
        badge.textContent = 'SAMPLE';
        meta.append(badge);
      }
      const stars = document.createElement('div');
      stars.className = 'review-stars';
      stars.setAttribute('aria-label', review.rating + ' out of 5 stars');
      stars.textContent = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
      const text = document.createElement('p');
      text.className = 'review-text';
      text.textContent = review.feedback;
      content.append(meta, stars, text);
      card.append(avatar, content);
      reviewList.append(card);
    });
  }

  ratingButtons.forEach((button) => {
    button.addEventListener('click', () => {
      selectedRating = Number(button.dataset.rating);
      ratingButtons.forEach((star) => {
        const active = Number(star.dataset.rating) <= selectedRating;
        star.classList.toggle('is-selected', active);
        star.textContent = active ? '★' : '☆';
        star.setAttribute('aria-pressed', String(Number(star.dataset.rating) === selectedRating));
      });
      ratingHint.textContent = selectedRating + (selectedRating === 1 ? ' star selected' : ' stars selected');
    });
  });

  reviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selectedRating) {
      reviewStatus.textContent = 'Please choose a star rating before posting.';
      ratingButtons[0].focus();
      return;
    }
    const formData = new FormData(reviewForm);
    const newReview = {
      name: String(formData.get('name') || '').trim() || 'Guest',
      rating: selectedRating,
      feedback: String(formData.get('feedback') || '').trim()
    };
    if (!newReview.feedback) {
      reviewStatus.textContent = 'Please add a feedback note before posting.';
      document.getElementById('review-message').focus();
      return;
    }
    reviews.push(newReview);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
    } catch (error) {
      reviews.pop();
      reviewStatus.textContent = 'Your feedback could not be saved in this browser. Please try again.';
      console.error('Unable to save feedback:', error);
      return;
    }
    reviewForm.reset();
    selectedRating = 0;
    ratingButtons.forEach((star) => {
      star.classList.remove('is-selected');
      star.textContent = '☆';
      star.setAttribute('aria-pressed', 'false');
    });
    ratingHint.textContent = 'Tap a star to rate';
    reviewStatus.textContent = 'Thank you! Your feedback has been saved on this device.';
    renderReviews();
  });

  loadReviews();
  renderReviews();
})();

/**
 * Cart decant upsell.
 *
 * Handles the "Adicionar" buttons rendered by snippets/cart-decant-upsell.liquid
 * (shown in both the cart drawer and the cart page). Adds the chosen decant
 * variant to the cart via the Ajax API, then dispatches the theme's
 * `CartLinesUpdateEvent` (from `@shopify/events`) so the theme's own
 * cart-items-component, cart-icon and header-actions components refresh
 * themselves automatically — the same contract `product-form.js` uses for
 * the regular add-to-cart buttons.
 *
 * On a successful add, the card that was just added is swapped out for
 * another suggestion (pulled from a hidden reserve pool rendered by
 * cart-decant-upsell.liquid) instead of being left in a static "added"
 * state, so the upsell keeps offering fresh decants.
 */
import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

(function () {
  if (window.__cartDecantUpsellInitialized) return;
  window.__cartDecantUpsellInitialized = true;

  var DEFAULT_TIMEOUT_MS = 8000;
  var REMOVE_ANIMATION_MS = 200;

  function getCartAddUrl() {
    if (window.Theme && window.Theme.routes && window.Theme.routes.cart_add_url) {
      return window.Theme.routes.cart_add_url;
    }
    return '/cart/add.js';
  }

  function getCartUrl() {
    if (window.Theme && window.Theme.routes && window.Theme.routes.cart_url) {
      return window.Theme.routes.cart_url;
    }
    return '/cart';
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs || DEFAULT_TIMEOUT_MS);

    var opts = Object.assign({}, options, { signal: controller.signal });

    return fetch(url, opts).finally(function () {
      clearTimeout(timer);
    });
  }

  function getSectionIds() {
    var nodes = document.querySelectorAll('cart-items-component[data-section-id]');
    var ids = [];
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute('data-section-id');
      if (id && ids.indexOf(id) === -1) ids.push(id);
    }
    return ids;
  }

  function setLoading(button, isLoading) {
    var spinner = button.querySelector('[data-decant-spinner]');
    button.disabled = isLoading;
    if (isLoading) {
      button.setAttribute('data-loading', 'true');
    } else {
      button.removeAttribute('data-loading');
    }
    if (spinner) spinner.hidden = !isLoading;
  }

  function setLabel(button, text) {
    var label = button.querySelector('[data-decant-add-label]');
    if (label) label.textContent = text;
  }

  /**
   * Fetches the current cart state. Used to resolve the CartLinesUpdateEvent
   * promise with the up-to-date item list/total, matching how the theme's
   * own add-to-cart flow (product-form.js) resolves its own promise.
   */
  function refreshCart() {
    return fetch(getCartUrl() + '.json', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    }).then(function (response) {
      if (!response.ok) throw new Error('Failed to fetch cart: ' + response.status);
      return response.json();
    });
  }

  /**
   * Replaces the just-added card with the next hidden reserve card, so the
   * slot offers a fresh decant instead of sitting there marked "added". If
   * no reserve card is left, falls back to the old static "added" state.
   * @param {Element | null} card
   */
  function swapCard(card) {
    if (!card) return;

    var list = card.parentElement;
    var nextPoolCard = list ? list.querySelector('[data-decant-pool-card]') : null;

    if (!nextPoolCard) {
      card.setAttribute('data-added', 'true');
      return;
    }

    card.classList.add('is-removing');

    setTimeout(function () {
      card.remove();
      nextPoolCard.hidden = false;
      nextPoolCard.removeAttribute('data-decant-pool-card');
    }, REMOVE_ANIMATION_MS);
  }

  function handleAddClick(button) {
    if (button.disabled) return;

    var variantId = button.getAttribute('data-variant-id');
    if (!variantId) return;

    var card = button.closest('[data-decant-upsell-card]');
    var originalLabel = button.querySelector('[data-decant-add-label]')
      ? button.querySelector('[data-decant-add-label]').textContent
      : 'Adicionar';

    setLoading(button, true);

    var sectionIds = getSectionIds();
    var deferredUpdate = CartLinesUpdateEvent.createPromise();

    document.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'cart',
        lines: [{ merchandiseId: String(variantId), quantity: 1 }],
        promise: deferredUpdate.promise,
      })
    );

    fetchWithTimeout(getCartAddUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        items: [{ id: Number(variantId), quantity: 1 }],
        sections: sectionIds.join(','),
      }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        setLoading(button, false);

        if (!result.ok) {
          var message =
            (result.data && (result.data.description || result.data.message)) ||
            'Não foi possível adicionar o decant.';
          setLabel(button, 'Tentar novamente');

          refreshCart()
            .then(function (ajaxCart) {
              deferredUpdate.resolve({
                cart: CartLinesUpdateEvent.createCartFromAjaxResponse(ajaxCart),
                detail: {
                  didError: true,
                  items: ajaxCart.items,
                  source: 'cart-decant-upsell',
                  sourceId: 'cart-decant-upsell',
                  itemCount: ajaxCart.item_count,
                },
              });
            })
            .catch(function (error) {
              deferredUpdate.reject(error);
            });

          document.dispatchEvent(
            new CartErrorEvent({
              error: message,
              code: 'INVALID',
            })
          );
          return;
        }

        swapCard(card);

        refreshCart()
          .then(function (ajaxCart) {
            deferredUpdate.resolve({
              cart: CartLinesUpdateEvent.createCartFromAjaxResponse(ajaxCart),
              detail: {
                items: ajaxCart.items,
                source: 'cart-decant-upsell',
                sourceId: 'cart-decant-upsell',
                itemCount: ajaxCart.item_count,
                sections: result.data.sections,
                didError: false,
              },
            });
          })
          .catch(function (error) {
            deferredUpdate.reject(error);
          });
      })
      .catch(function (error) {
        setLoading(button, false);
        setLabel(button, 'Tentar novamente');
        deferredUpdate.reject(error);

        document.dispatchEvent(
          new CartErrorEvent({
            error: (error && error.message) || 'Falha de rede ao adicionar o decant.',
            code: 'SERVICE_UNAVAILABLE',
          })
        );

        setTimeout(function () {
          setLabel(button, originalLabel);
        }, 2500);
      });
  }

  document.addEventListener('click', function (event) {
    var addButton = event.target.closest('[data-decant-add-button]');
    if (!addButton) return;
    event.preventDefault();
    handleAddClick(addButton);
  });
})();

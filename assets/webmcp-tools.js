(() => {
  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function') return;

  const registrationController = new AbortController();
  const localeRoot = window.Shopify?.routes?.root || '/';
  const currencyCode =
    window.Shopify?.currency?.active || document.querySelector('variant-selects')?.dataset.currencyCode || null;

  const textResult = (message, data = {}) => ({
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: true, ...data },
  });

  const errorResult = (error) => ({
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    structuredContent: {
      ok: false,
      error: {
        code: error?.code || error?.name || 'STOREFRONT_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    },
  });

  const storefrontError = (message, code = 'STOREFRONT_ERROR') => {
    const error = new Error(message);
    error.code = code;
    return error;
  };

  const stripHtml = (value = '') => {
    if (value == null) return '';
    const documentFragment = new DOMParser().parseFromString(String(value), 'text/html');
    return documentFragment.body.textContent?.replace(/\s+/g, ' ').trim() || '';
  };

  const readPriceText = (price) => {
    if (!price) return null;
    const selector = price.classList.contains('price--on-sale')
      ? '.price__sale .price-item--sale'
      : '.price__regular .price-item--regular';
    const value = price.querySelector(selector)?.textContent || price.textContent;
    return value?.replace(/\s+/g, ' ').trim() || null;
  };

  const absoluteUrl = (value) => new URL(value, window.location.origin).href;

  const decimalAmount = (cents) => {
    const value = Number(cents);
    return Number.isFinite(value) ? (value / 100).toFixed(2) : null;
  };

  const money = (cents) => ({
    amount: decimalAmount(cents),
    currencyCode,
  });

  const normalizeHandle = (value) => {
    const handle = String(value || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(handle)) {
      throw storefrontError(`Invalid product or collection handle: ${handle || '(empty)'}`, 'INVALID_HANDLE');
    }
    return handle;
  };

  const fetchJson = async (url, signal) => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      throw storefrontError(`Storefront request failed with status ${response.status}.`, 'HTTP_ERROR');
    }
    return response.json();
  };

  const getProductHandleFromUrl = (value) => {
    try {
      const match = new URL(value, window.location.origin).pathname.match(/\/products\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  };

  const parseViewPayload = (element) => {
    try {
      return JSON.parse(element.getAttribute('view-event-payload') || '{}');
    } catch {
      return {};
    }
  };

  const readProductsFromDocument = (sourceDocument, limit = 20) => {
    const productElements = sourceDocument.querySelectorAll(
      '#ProductGridContainer product-component, #product-grid product-component, main product-component',
    );
    const products = [];
    const seenHandles = new Set();

    for (const element of productElements) {
      if (products.length >= limit) break;
      const link = element.querySelector('a[href*="/products/"]');
      const payload = parseViewPayload(element);
      const payloadProduct = payload.productVariant?.product || payload.product || payload;
      const handle = payloadProduct.handle || getProductHandleFromUrl(link?.href);
      if (!handle || seenHandles.has(handle)) continue;

      const heading = element.querySelector('.card__heading, h1, h2, h3');
      const vendor = element.querySelector('.caption-with-letter-spacing');
      const price = element.querySelector('.price');
      const soldOut = /sold out|unavailable/i.test(element.textContent || '');

      seenHandles.add(handle);
      products.push({
        id: payloadProduct.id ? String(payloadProduct.id) : null,
        title: payloadProduct.title || heading?.textContent?.replace(/\s+/g, ' ').trim() || handle,
        handle,
        vendor: payloadProduct.vendor || vendor?.textContent?.replace(/\s+/g, ' ').trim() || null,
        url: absoluteUrl(link?.getAttribute('href') || `${localeRoot}products/${handle}`),
        priceText: readPriceText(price),
        available: !soldOut,
      });
    }

    return products;
  };

  const readFacetSummary = (sourceDocument) => {
    const groups = new Map();
    const inputs = sourceDocument.querySelectorAll(
      '#FacetFiltersForm [name^="filter."], #FacetFiltersFormMobile [name^="filter."]',
    );

    for (const input of inputs) {
      const parameter = input.name;
      if (!parameter) continue;
      if (!groups.has(parameter)) {
        groups.set(parameter, {
          parameter,
          label: input.closest('details')?.querySelector('summary span')?.textContent?.trim() || parameter,
          values: [],
        });
      }

      const group = groups.get(parameter);
      if (input.dataset.max) {
        group.range = {
          min: input.dataset.min || '0',
          max: input.dataset.max,
        };
      }
      if (!input.value) continue;
      if (group.values.length >= 30 || group.values.some((item) => item.value === input.value)) continue;
      const label = input.id ? sourceDocument.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      group.values.push({
        value: input.value,
        label: label?.textContent?.replace(/\s+/g, ' ').trim() || input.value,
        active: input.checked || false,
      });
    }

    const sortSelect = sourceDocument.querySelector('select[name="sort_by"]');
    return {
      filters: Array.from(groups.values()),
      sortOptions: sortSelect
        ? Array.from(sortSelect.options).map((option) => ({
            value: option.value,
            label: option.textContent?.trim() || option.value,
            active: option.selected,
          }))
        : [],
    };
  };

  const discoveryUrl = ({ query, collectionHandle, filters = [], sortBy }) => {
    const currentUrl = new URL(window.location.href);
    const rootPath = localeRoot.endsWith('/') ? localeRoot : `${localeRoot}/`;
    let pathname;

    if (typeof query === 'string') {
      pathname = `${rootPath}search`;
    } else if (collectionHandle) {
      pathname = `${rootPath}collections/${normalizeHandle(collectionHandle)}`;
    } else if (/\/(collections\/[^/]+|search)\/?$/.test(currentUrl.pathname)) {
      pathname = currentUrl.pathname;
    } else {
      pathname = `${rootPath}collections/all`;
    }

    const url = new URL(pathname.replace(/\/{2,}/g, '/'), window.location.origin);
    if (url.pathname.endsWith('/search')) {
      const searchQuery = typeof query === 'string' ? query.trim() : currentUrl.searchParams.get('q') || '';
      if (!searchQuery) throw storefrontError('A search query is required on search pages.', 'QUERY_REQUIRED');
      url.searchParams.set('q', searchQuery);
      url.searchParams.set('type', 'product');
    }

    if (sortBy) url.searchParams.set('sort_by', String(sortBy));

    for (const filter of filters) {
      const parameter = String(filter?.parameter || '');
      const value = String(filter?.value || '');
      if (!parameter.startsWith('filter.') || !value) {
        throw storefrontError(
          'Each filter must use a parameter returned by this tool and include a non-empty value.',
          'INVALID_FILTER',
        );
      }
      url.searchParams.append(parameter, value);
    }

    return url;
  };

  const fetchDiscovery = async (input, signal) => {
    const limit = Math.min(Math.max(Number(input.limit) || 12, 1), 50);
    const url = discoveryUrl(input);
    const response = await fetch(url, { credentials: 'same-origin', signal });
    if (!response.ok) {
      throw storefrontError(`Product discovery failed with status ${response.status}.`, 'DISCOVERY_FAILED');
    }
    const html = await response.text();
    const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
    const products = readProductsFromDocument(parsedDocument, limit);
    const facets = readFacetSummary(parsedDocument);

    return {
      url: url.href,
      products,
      resultCount: products.length,
      ...facets,
    };
  };

  const waitForGridUpdate = (callback) =>
    new Promise((resolve, reject) => {
      const grid = document.getElementById('ProductGridContainer');
      if (!grid) {
        reject(storefrontError('The current page does not contain a Dawn product grid.', 'PRODUCT_GRID_UNAVAILABLE'));
        return;
      }

      let timeout;
      const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        observer.disconnect();
        resolve('section-render');
      });
      observer.observe(grid, { childList: true, subtree: true });
      timeout = setTimeout(() => {
        observer.disconnect();
        resolve('section-render-requested');
      }, 5000);

      try {
        callback();
      } catch (error) {
        clearTimeout(timeout);
        observer.disconnect();
        reject(error);
      }
    });

  const applyDiscoveryToPage = async (url) => {
    const canRenderSection =
      url.pathname === window.location.pathname &&
      typeof FacetFiltersForm !== 'undefined' &&
      document.getElementById('ProductGridContainer');

    if (canRenderSection) {
      const mode = await waitForGridUpdate(() => FacetFiltersForm.renderPage(url.searchParams.toString()));
      return { mode, url: window.location.href };
    }

    setTimeout(() => window.location.assign(url.href), 50);
    return { mode: 'navigation-requested', url: url.href };
  };

  const normalizeProduct = (product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const prices = variants.map((variant) => Number(variant.price)).filter(Number.isFinite);
    const optionDefinitions = (Array.isArray(product.options) ? product.options : []).map((option, index) => {
      const name = typeof option === 'string' ? option : option.name;
      const values = [
        ...new Set(
          variants
            .map((variant) => variant.options?.[index] || variant[`option${index + 1}`])
            .filter((value) => value != null),
        ),
      ];
      return { name, values };
    });

    return {
      id: String(product.id),
      title: product.title,
      handle: product.handle,
      vendor: product.vendor || null,
      productType: product.type || null,
      description: stripHtml(product.description).slice(0, 800),
      url: absoluteUrl(product.url || `${localeRoot}products/${product.handle}`),
      available: product.available ?? variants.some((variant) => variant.available),
      priceRange: {
        min: prices.length ? money(Math.min(...prices)) : null,
        max: prices.length ? money(Math.max(...prices)) : null,
      },
      options: optionDefinitions,
      variants: variants.map((variant) => ({
        id: String(variant.id),
        title: variant.title,
        available: Boolean(variant.available),
        sku: variant.sku || null,
        price: money(variant.price),
        compareAtPrice: variant.compare_at_price ? money(variant.compare_at_price) : null,
        selectedOptions: optionDefinitions.map((option, index) => ({
          name: option.name,
          value: variant.options?.[index] || variant[`option${index + 1}`] || null,
        })),
      })),
      featuredImage: product.featured_image || null,
      images: Array.isArray(product.images) ? product.images.slice(0, 8) : [],
    };
  };

  const fetchProduct = async (handle, signal) => {
    const normalizedHandle = normalizeHandle(handle);
    const product = await fetchJson(`${localeRoot}products/${normalizedHandle}.js`, signal);
    return normalizeProduct(product);
  };

  const visibleProductHandles = () => {
    const handles = [];
    const add = (handle) => {
      if (handle && !handles.includes(handle)) handles.push(handle);
    };

    document.querySelectorAll('variant-selects[data-product-handle]').forEach((element) => {
      add(element.dataset.productHandle);
    });
    document.querySelectorAll('product-component a[href*="/products/"]').forEach((link) => {
      add(getProductHandleFromUrl(link.href));
    });
    return handles.slice(0, 10);
  };

  const requestedHandles = (input, minimum = 1, maximum = 10) => {
    const handles = Array.isArray(input.handles) && input.handles.length ? input.handles : visibleProductHandles();
    const uniqueHandles = [...new Set(handles.map(normalizeHandle))];
    if (uniqueHandles.length < minimum) {
      throw storefrontError(`At least ${minimum} product handle${minimum === 1 ? '' : 's'} required.`, 'PRODUCTS_REQUIRED');
    }
    if (uniqueHandles.length > maximum) {
      throw storefrontError(`No more than ${maximum} products can be requested at once.`, 'TOO_MANY_PRODUCTS');
    }
    return uniqueHandles;
  };

  const getActions = async (signal) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 3000) {
      const actions = window.Shopify?.actions;
      if (actions?.getCart && actions?.updateCart && actions?.openCart) return actions;
      if (signal?.aborted) throw signal.reason || storefrontError('The operation was cancelled.', 'ABORTED');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw storefrontError('Shopify Standard Actions are not available on this storefront.', 'CART_ACTIONS_UNAVAILABLE');
  };

  const normalizeActionCart = (cart) => {
    if (!cart) return null;
    const lines = Array.isArray(cart.lines)
      ? cart.lines
      : Array.isArray(cart.lines?.nodes)
        ? cart.lines.nodes
        : Array.isArray(cart.lines?.edges)
          ? cart.lines.edges.map((edge) => edge?.node).filter(Boolean)
          : [];
    return {
      totalQuantity: cart.totalQuantity ?? null,
      total: cart.cost?.totalAmount || null,
      discountCodes: cart.discountCodes || [],
      lines: lines.map((line) => ({
        lineId: line.id,
        quantity: line.quantity,
        total: line.cost?.totalAmount || null,
      })),
    };
  };

  const fetchAjaxCart = async (signal) => {
    const cart = await fetchJson(`${localeRoot}cart.js`, signal);
    return {
      itemCount: cart.item_count,
      total: money(cart.total_price),
      note: cart.note || null,
      lines: (cart.items || []).map((item) => ({
        lineId: item.key,
        productId: String(item.product_id),
        variantId: String(item.variant_id),
        title: item.product_title || item.title,
        variantTitle: item.variant_title || null,
        handle: item.handle || getProductHandleFromUrl(item.url),
        vendor: item.vendor || null,
        quantity: item.quantity,
        unitPrice: money(item.final_price ?? item.price),
        lineTotal: money(item.final_line_price ?? item.line_price),
        url: item.url ? absoluteUrl(item.url) : null,
        image: item.image || null,
      })),
    };
  };

  const updateCart = async (payload, signal, context) => {
    const actions = await getActions(signal);
    const result = await actions.updateCart(payload, { signal, event: { context } });
    if (result.userErrors?.length) {
      const error = storefrontError(result.userErrors.map((item) => item.message).join(' '), 'CART_REJECTED');
      error.userErrors = result.userErrors;
      throw error;
    }
    return {
      cart: normalizeActionCart(result.cart),
      warnings: result.warnings || [],
    };
  };

  const scheduleOpenCart = (actions) => {
    setTimeout(() => {
      Promise.resolve(actions.openCart()).catch((error) => console.warn('Unable to open cart.', error));
    }, 50);
  };

  const productDiscoverySchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Free-text product search. When supplied, searches the product catalog.',
      },
      collectionHandle: {
        type: 'string',
        description: 'Optional collection handle, such as snowboards. Omit when using query.',
      },
      filters: {
        type: 'array',
        description: 'Exact storefront filters. Use parameter and value pairs returned by search_products.',
        items: {
          type: 'object',
          properties: {
            parameter: { type: 'string', description: 'A Shopify filter parameter beginning with filter.' },
            value: { type: 'string', description: 'The exact filter value.' },
          },
          required: ['parameter', 'value'],
          additionalProperties: false,
        },
      },
      sortBy: {
        type: 'string',
        description: 'Optional exact sort value returned by search_products.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Maximum number of products to return. Defaults to 12.',
      },
    },
    additionalProperties: false,
  };

  const toolDefinitions = [
    {
      name: 'search_products',
      title: 'Search products',
      description:
        'Searches products or browses a collection without changing the visible page. Returns matching product summaries, exact available storefront filter parameters and values, and sort options. Use the returned handles with get_product_details or compare_products.',
      inputSchema: productDiscoverySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input, options) {
        const discovery = await fetchDiscovery(input, options?.signal);
        return textResult(`Found ${discovery.resultCount} products.`, discovery);
      },
    },
    {
      name: 'apply_product_filters',
      title: 'Show filtered products',
      description:
        'Applies a product search, collection, sort order, or exact storefront filters to the buyer-visible page. Updates the current Dawn product grid when possible and otherwise navigates to the matching search or collection URL.',
      inputSchema: productDiscoverySchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input, options) {
        const discovery = await fetchDiscovery(input, options?.signal);
        const pageUpdate = await applyDiscoveryToPage(new URL(discovery.url));
        return textResult(`Showing ${discovery.resultCount} matching products.`, { ...discovery, pageUpdate });
      },
    },
    {
      name: 'get_product_details',
      title: 'Get product details',
      description:
        'Returns accurate storefront product details, options, prices, availability, and variant IDs. Pass product handles, or omit them to inspect products currently visible on the page. Variant IDs from this result can be passed to add_to_cart.',
      inputSchema: {
        type: 'object',
        properties: {
          handles: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            description: 'Product handles. Omit to inspect visible products.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input, options) {
        const handles = requestedHandles(input);
        const settled = await Promise.allSettled(handles.map((handle) => fetchProduct(handle, options?.signal)));
        const products = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
        const errors = settled
          .map((item, index) => ({ item, handle: handles[index] }))
          .filter(({ item }) => item.status === 'rejected')
          .map(({ item, handle }) => ({ handle, message: item.reason?.message || String(item.reason) }));
        if (!products.length) throw storefrontError('No requested products could be loaded.', 'PRODUCTS_UNAVAILABLE');
        return textResult(`Loaded details for ${products.length} products.`, { products, errors });
      },
    },
    {
      name: 'compare_products',
      title: 'Compare products',
      description:
        'Compares two to four products using current storefront data. Returns price ranges, availability, vendors, product types, options, and available variant counts in a concise structured comparison.',
      inputSchema: {
        type: 'object',
        properties: {
          handles: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 4,
            uniqueItems: true,
            description: 'Two to four product handles to compare.',
          },
        },
        required: ['handles'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input, options) {
        const handles = requestedHandles(input, 2, 4);
        const products = await Promise.all(handles.map((handle) => fetchProduct(handle, options?.signal)));
        const comparison = products.map((product) => ({
          handle: product.handle,
          title: product.title,
          vendor: product.vendor,
          productType: product.productType,
          available: product.available,
          priceRange: product.priceRange,
          availableVariants: product.variants.filter((variant) => variant.available).length,
          totalVariants: product.variants.length,
          options: product.options,
          url: product.url,
        }));
        return textResult(`Compared ${comparison.length} products.`, { comparison });
      },
    },
    {
      name: 'add_to_cart',
      title: 'Add product to cart',
      description:
        'Adds a product variant to the Shopify cart through the storefront standard cart action and refreshes Dawn cart UI. Pass a variant ID from get_product_details, or omit variantId on a product page to add the currently selected variant. Opens the cart for buyer review unless openCart is false.',
      inputSchema: {
        type: 'object',
        properties: {
          variantId: {
            type: 'string',
            description: 'Raw Shopify variant ID or ProductVariant GID. Omit to use the current product selection.',
          },
          quantity: { type: 'integer', minimum: 1, maximum: 99, description: 'Quantity to add. Defaults to 1.' },
          openCart: {
            type: 'boolean',
            description: 'Whether to show the cart after adding. Defaults to true so the buyer can review the change.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input, options) {
        const selectedInput = document.querySelector(
          'product-info product-form input[name="id"], product-form input[name="id"]',
        );
        const variantId = String(input.variantId || selectedInput?.value || '').trim();
        if (!variantId) {
          throw storefrontError('A variant ID is required when no product variant is selected on the page.', 'VARIANT_REQUIRED');
        }
        const quantity = Number(input.quantity) || 1;
        const result = await updateCart(
          { lines: [{ merchandiseId: variantId, quantity }] },
          options?.signal,
          'product',
        );
        if (input.openCart !== false) scheduleOpenCart(await getActions(options?.signal));
        return textResult(`Added quantity ${quantity} of variant ${variantId} to the cart.`, {
          variantId,
          quantity,
          ...result,
        });
      },
    },
    {
      name: 'get_cart_details',
      title: 'Get cart details',
      description:
        'Returns the current Shopify cart without changing it, including line IDs, product and variant IDs, titles, quantities, prices, totals, and discount codes. Use returned lineId values with update_cart_line or remove_cart_line.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input, options) {
        const actions = await getActions(options?.signal);
        const [{ cart }, storefrontCart] = await Promise.all([
          actions.getCart({}, { signal: options?.signal }),
          fetchAjaxCart(options?.signal),
        ]);
        return textResult(
          storefrontCart.itemCount
            ? `The cart contains ${storefrontCart.itemCount} items.`
            : 'The cart is empty.',
          { cart: normalizeActionCart(cart), storefrontCart },
        );
      },
    },
    {
      name: 'update_cart_line',
      title: 'Update cart line',
      description:
        'Changes the quantity of an existing cart line through the Shopify standard cart action and refreshes Dawn cart UI. Use a lineId returned by get_cart_details or Shopify\'s built-in get_cart tool and a quantity of at least 1.',
      inputSchema: {
        type: 'object',
        properties: {
          lineId: {
            type: 'string',
            minLength: 1,
            description: 'Cart line ID returned by get_cart_details or Shopify\'s built-in get_cart tool.',
          },
          quantity: { type: 'integer', minimum: 1, maximum: 99, description: 'New total quantity for this line.' },
        },
        required: ['lineId', 'quantity'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input, options) {
        const result = await updateCart(
          { lines: [{ id: input.lineId, quantity: input.quantity }] },
          options?.signal,
          'cart',
        );
        return textResult(`Updated the cart line quantity to ${input.quantity}.`, {
          lineId: input.lineId,
          quantity: input.quantity,
          ...result,
        });
      },
    },
    {
      name: 'remove_cart_line',
      title: 'Remove cart line',
      description:
        'Removes an existing cart line through the Shopify standard cart action and refreshes Dawn cart UI. Use a lineId returned by get_cart_details or Shopify\'s built-in get_cart tool.',
      inputSchema: {
        type: 'object',
        properties: {
          lineId: {
            type: 'string',
            minLength: 1,
            description: 'Cart line ID returned by get_cart_details or Shopify\'s built-in get_cart tool.',
          },
        },
        required: ['lineId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input, options) {
        const result = await updateCart({ lines: [{ id: input.lineId, quantity: 0 }] }, options?.signal, 'cart');
        return textResult('Removed the cart line.', { lineId: input.lineId, ...result });
      },
    },
    {
      name: 'open_cart',
      title: 'Open cart for review',
      description:
        'Shows the current cart using the storefront cart drawer when available or navigates to the cart page. This is a buyer-review handoff and does not start checkout.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input, options) {
        scheduleOpenCart(await getActions(options?.signal));
        return textResult('Opening the cart for buyer review.', { checkoutStarted: false });
      },
    },
  ];

  const registerTools = async () => {
    const results = await Promise.allSettled(
      toolDefinitions.map(({ execute, ...definition }) =>
        modelContext.registerTool(
          {
            ...definition,
            async execute(input = {}, options = {}) {
              try {
                return await execute(input, options);
              } catch (error) {
                return errorResult(error);
              }
            },
          },
          { signal: registrationController.signal },
        ),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Unable to register WebMCP tool ${toolDefinitions[index].name}.`, result.reason);
      }
    });
  };

  window.addEventListener(
    'pagehide',
    (event) => {
      if (!event.persisted) registrationController.abort();
    },
    { once: true },
  );

  void registerTools();
})();

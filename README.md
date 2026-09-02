# Agent-Ready Shopify Storefront with WebMCP

This project extends Shopify's Dawn theme with WebMCP Site tools. A compatible AI agent can search products, inspect variants, compare options, update the visible product listing, and manage the cart through structured tools instead of relying on page scraping.

The storefront remains a normal Shopify store for people and for browsers that do not support WebMCP.

## Live demo

[Open the Shopify theme preview](https://web-mcp-challenge.myshopify.com/?preview_theme_id=156401893562)

The preview is password protected. Testing credentials are included in the private submission instructions rather than stored in this public repository.

## What it demonstrates

- JavaScript-based WebMCP registration on the top-level storefront page
- Structured product discovery, filtering, product details, and comparison
- Variant-aware cart operations using Shopify Standard Storefront Actions
- Visible browser updates when an action should affect the buyer's view
- Structured results that let an agent verify cart mutations
- Progressive enhancement: the Dawn storefront still works without WebMCP
- Buyer-controlled checkout: custom tools never initiate checkout

## Custom Site tools

| Tool | Type | Purpose |
| --- | --- | --- |
| `search_products` | Read only | Searches products or browses a collection and returns product summaries, filters, and sort options. |
| `apply_product_filters` | Visible change | Applies search, filters, or sorting to the buyer-visible product grid. |
| `get_product_details` | Read only | Returns product options, prices, availability, and variant IDs. |
| `compare_products` | Read only | Compares two to four products using current storefront data. |
| `add_to_cart` | Cart mutation | Adds a selected Shopify variant and refreshes the Dawn cart interface. |
| `get_cart_details` | Read only | Returns normalized cart and storefront line-item details. |
| `update_cart_line` | Cart mutation | Sets the quantity of an existing cart line. |
| `remove_cart_line` | Cart mutation | Removes an existing cart line. |
| `open_cart` | Visible change | Opens the cart for buyer review without starting checkout. |

Shopify may also expose native commerce tools on the same page. The custom names are designed to coexist with them; for example, `get_cart_details` complements Shopify's native `get_cart` tool without creating a registration collision.

## How it works

The integration is implemented in [`assets/webmcp-tools.js`](assets/webmcp-tools.js). It checks for `document.modelContext.registerTool` and registers each tool with:

- A focused name and description
- A constrained JSON input schema
- Read-only or mutating annotations
- Human-readable content and structured results
- Stable error codes for failed operations

[`layout/theme.liquid`](layout/theme.liquid) loads the asset after `content_for_header`, allowing the browser-provided Site tools API and Shopify's storefront actions to initialize first.

Product discovery reads Shopify-rendered search or collection pages so the results match the storefront's catalog behavior. Detailed product and variant data comes from Shopify product JSON endpoints. Cart operations reuse Shopify Standard Storefront Actions, while the Ajax cart response supplies detailed line-item information.

Cart normalization supports the array, `nodes`, and `edges` connection shapes that Shopify actions can return.

## Project structure

```text
assets/webmcp-tools.js  WebMCP schemas, registration, product tools, and cart tools
layout/theme.liquid     Loads the WebMCP asset across the storefront
assets/                 Dawn JavaScript, styles, and static theme assets
sections/               Merchant-configurable Dawn sections
snippets/               Reusable Liquid components
templates/              Shopify JSON and Liquid templates
```

## Run locally

Install and authenticate the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli), then run the theme development server from the repository root:

```bash
shopify theme dev --store your-store.myshopify.com
```

To run Shopify's theme validation:

```bash
shopify theme check
```

## Test the Site tools

Use the latest ChatGPT desktop app with its built-in browser and GPT-5.6 Sol or Terra. In **Settings → Browser → Permissions**, ensure Site tools are enabled.

1. Open the storefront in the built-in browser.
2. Unlock the password-protected preview.
3. Select **Site tools → Available site tools** in the browser address bar.
4. Confirm that the nine custom tools listed above are available.
5. Try the following prompts.

```text
Use the custom search_products tool to search for snowboards and return the first five.
```

```text
Use apply_product_filters to show snowboard results sorted by price, lowest first.
```

```text
Compare The Collection Snowboard: Hydrogen with The Complete Snowboard.
```

```text
Show the available variants of The Complete Snowboard, then add one Sunset variant to my cart. Do not proceed to checkout.
```

```text
Show my detailed cart contents, change the snowboard quantity to two, and open the cart for review. Do not proceed to checkout.
```

Read-only tools such as `search_products` intentionally do not change the visible page. To verify their use, open **Site tools → Recently used → Sources**. Tools such as `apply_product_filters`, `add_to_cart`, and `open_cart` produce visible storefront changes.

## Compatibility note

The ChatGPT built-in browser currently discovers JavaScript tools registered through `document.modelContext` on the top-level page. Some third-party WebMCP inspectors target other proposal variants, such as `navigator.modelContext`, declarative HTML attributes, or a `/.well-known/webmcp` document. Those audits may not report these tools even though ChatGPT Site tools and browser developer tools discover and invoke them successfully.

## Safety boundaries

- The custom integration does not expose a checkout tool.
- Cart-changing tools describe their side effects and return the resulting state.
- Existing Shopify authentication, authorization, validation, and cart behavior remain authoritative.
- Website tool definitions and results should still be treated as untrusted input by compatible agents.

## Built with

- Shopify and the Dawn theme
- Shopify Liquid
- JavaScript, HTML, and CSS
- WebMCP Site tools
- JSON Schema
- Shopify Standard Storefront Actions

## Repository

[github.com/RSeveryn/web-mcp-challenge](https://github.com/RSeveryn/web-mcp-challenge)

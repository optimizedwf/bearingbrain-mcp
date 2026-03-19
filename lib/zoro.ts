/**
 * Zoro.com Affiliate Link Builder
 * Zoro is Grainger's e-commerce subsidiary — 4-6.4% commission, 30-day cookie
 *
 * Affiliate network: CJ Affiliate (Commission Junction)
 * Sign up: https://www.cj.com → find Zoro Tools Inc advertiser
 *
 * How CJ deep links work:
 *   https://www.anrdoezrs.net/click-{PUBLISHER_ID}-{ADVERTISER_ID}?url={ENCODED_DESTINATION}
 *
 * Zoro product URL format:
 *   https://www.zoro.com/product/{slug}/i/{ZORO_ITEM_ID}/
 *   OR search: https://www.zoro.com/search?q={PART_NUMBER}
 */

const CJ_PUBLISHER_ID    = process.env.CJ_PUBLISHER_ID    ?? ''
const CJ_DEEP_LINK_BASE  = process.env.CJ_DEEP_LINK_BASE  ?? 'https://www.anrdoezrs.net'
const ZORO_ADVERTISER_ID = process.env.ZORO_CJ_ADVERTISER_ID ?? '10046064'  // Zoro's CJ advertiser ID

/**
 * Build a tracked Zoro affiliate link for a specific product page
 */
export function buildZoroAffiliateLink(zoroUrl: string): string {
  if (!CJ_PUBLISHER_ID) {
    // No affiliate ID configured — return direct link
    return zoroUrl
  }

  const encoded = encodeURIComponent(zoroUrl)
  return `${CJ_DEEP_LINK_BASE}/click-${CJ_PUBLISHER_ID}-${ZORO_ADVERTISER_ID}?url=${encoded}`
}

/**
 * Build a Zoro search URL for a part number (when we don't have a direct product URL)
 * This still gets affiliate credit if they buy within 30 days
 */
export function buildZoroSearchLink(partNumber: string): string {
  const searchUrl = `https://www.zoro.com/search?q=${encodeURIComponent(partNumber)}`
  return buildZoroAffiliateLink(searchUrl)
}

/**
 * Build a Zoro direct product link from their item ID
 */
export function buildZoroProductLink(zoroItemId: string, slug = ''): string {
  const productUrl = slug
    ? `https://www.zoro.com/product/${slug}/i/${zoroItemId}/`
    : `https://www.zoro.com/i/${zoroItemId}/`
  return buildZoroAffiliateLink(productUrl)
}

/**
 * Parse a Zoro product feed CSV row into our supplier_listing format
 * CJ Affiliate provides these feeds — download from CJ dashboard → Advertisers → Zoro → Data Feeds
 */
export interface ZoroFeedRow {
  'Product ID': string
  'Product Name': string
  'Buy URL': string
  'Price': string
  'In Stock': string
  'SKU': string
  'Brand': string
  'Description': string
  'Image URL': string
}

export function parseZoroFeedRow(row: ZoroFeedRow) {
  return {
    supplier_sku:    row['Product ID'] || row['SKU'],
    supplier_url:    row['Buy URL'],
    affiliate_url:   buildZoroAffiliateLink(row['Buy URL']),
    price_usd:       row['Price'] ? parseFloat(row['Price'].replace('$', '')) : null,
    in_stock:        row['In Stock']?.toLowerCase() === 'yes' || row['In Stock'] === '1',
    name:            row['Product Name'],
    description:     row['Description'],
    image_url:       row['Image URL'],
    brand:           row['Brand'],
  }
}

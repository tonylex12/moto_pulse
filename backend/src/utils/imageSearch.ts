/**
 * Keyless, scraper-based search utility to fetch a representative motorcycle image URL.
 * It queries DuckDuckGo for the bike model, extracts the first search result link,
 * and scrapes its OpenGraph (og:image) featured image tag.
 */
async function scrapeImageForQuery(queryText: string): Promise<string | null> {
  const query = encodeURIComponent(queryText);
  const url = `https://html.duckduckgo.com/html/?q=${query}`;

  console.log(`🔍 Scraping image search for: ${queryText}...`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      console.warn(`⚠️ Image search DDG request failed with status ${response.status}.`);
      return null;
    }

    const html = await response.text();
    
    // Find all results snippets which contain links
    const snippetRegex = /<a class="result__snippet"[^>]*href="([^"]+)"/g;
    let match;
    const targetUrls: string[] = [];
    
    while ((match = snippetRegex.exec(html)) !== null) {
      let targetUrl = match[1];
      // Decode DuckDuckGo redirects if present
      if (targetUrl.includes('uddg=')) {
        const parts = targetUrl.split('uddg=');
        if (parts[1]) {
          targetUrl = decodeURIComponent(parts[1].split('&')[0]);
        }
      }
      // Filter out duckduckgo urls or advertisements if any
      if (targetUrl.startsWith('http') && !targetUrl.includes('duckduckgo.com')) {
        targetUrls.push(targetUrl);
      }
    }

    // Sort targetUrls so that high-quality domains come first
    const highQualityDomains = [
      'wikipedia.org',
      'wikimedia.org',
      'cycleworld.com',
      'motorcycle.com',
      'motorcyclenews.com',
      'topspeed.com',
      'autoevolution.com',
      'ultimatemotorcycling.com'
    ];
    
    targetUrls.sort((a, b) => {
      const aIsHigh = highQualityDomains.some(d => a.toLowerCase().includes(d)) ? 1 : 0;
      const bIsHigh = highQualityDomains.some(d => b.toLowerCase().includes(d)) ? 1 : 0;
      return bIsHigh - aIsHigh;
    });

    console.log(`🤖 Found ${targetUrls.length} web pages. Scoping to top 5 prioritized candidates.`);
    
    // Scrape the top 5 web pages sequentially to find a valid og:image
    for (const targetUrl of targetUrls.slice(0, 5)) {
      try {
        console.log(`📸 Scraping OpenGraph image from page: ${targetUrl}...`);
        const pageResponse = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(4000) // Timeout after 4 seconds to prevent hanging
        });

        if (!pageResponse.ok) continue;

        const pageHtml = await pageResponse.text();
        
        // Match og:image and twitter:image meta tags
        const ogRegex1 = /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i;
        const ogRegex2 = /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i;
        const twRegex1 = /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i;
        const twRegex2 = /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i;

        const imgMatch = ogRegex1.exec(pageHtml) || 
                         ogRegex2.exec(pageHtml) || 
                         twRegex1.exec(pageHtml) || 
                         twRegex2.exec(pageHtml);

        if (imgMatch && imgMatch[1]) {
          let imageUrl = imgMatch[1].trim();
          // Ensure it is a secure fully-qualified absolute URL
          if (imageUrl.startsWith('//')) {
            imageUrl = 'https:' + imageUrl;
          } else if (imageUrl.startsWith('/')) {
            // Relative URL, resolve to base domain
            const urlObj = new URL(targetUrl);
            imageUrl = urlObj.origin + imageUrl;
          }

          // Clean up nested absolute URLs (e.g. '/images/https://example.com/img.jpg' resolved to 'https://domain.com/images/https://example.com/img.jpg')
          const lastHttpIndex = imageUrl.lastIndexOf('http');
          if (lastHttpIndex > 0) {
            imageUrl = imageUrl.substring(lastHttpIndex);
          }
          
          if (imageUrl.startsWith('http')) {
            // Filter out layout images/logos/avatars using word boundaries to avoid false positives (e.g. matching 'uploads' or 'download' via 'ad')
            const blacklistRegex = /\b(logo|avatar|icon|profile|author|banner|header|default|placeholder|theme|css|sprite|button|ad|ads|advertisement|pixel|spacer|loader|spinner)\b/i;
            if (blacklistRegex.test(imageUrl)) {
              console.log(`⚠️ Ignored layout/logo image candidate: ${imageUrl}`);
              continue;
            }
            console.log(`✅ Extracted motorcycle image URL: ${imageUrl}`);
            return imageUrl;
          }
        }
      } catch (pageErr) {
        console.warn(`⚠️ Failed to scrape page ${targetUrl} for images:`, pageErr);
      }
    }
  } catch (error) {
    console.error('Error during image scraping search:', error);
  }

  return null;
}

export async function fetchVehicleImage(brand: string, model: string, year: number): Promise<string | null> {
  // 1. Try local catalog query to match national market catalogs (somosmoto.pe, motocorp.pe, efe.com.pe)
  const localQuery = `${brand} ${model} site:somosmoto.pe OR site:motocorp.pe OR site:efe.com.pe`;
  console.log(`🔍 Scraping image search for local catalog: ${localQuery}...`);
  const localImg = await scrapeImageForQuery(localQuery);
  if (localImg) return localImg;

  // 2. Try general spanish query
  const queryEs = `${brand} ${model} ${year} moto fotografia foto`;
  console.log(`🔍 Scraping image search for general Spanish: ${queryEs}...`);
  const esImg = await scrapeImageForQuery(queryEs);
  if (esImg) return esImg;

  // 3. Fallback to general english query
  const queryText = `${brand} ${model} ${year} motorcycle photo review`;
  console.log(`🔍 Scraping image search for: ${queryText}...`);
  return await scrapeImageForQuery(queryText);
}

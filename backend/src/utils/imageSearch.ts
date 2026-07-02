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

    console.log(`🤖 Found ${targetUrls.length} web pages to scrape for images.`);
    
    // Scrape the top 2 web pages sequentially to find a valid og:image
    for (const targetUrl of targetUrls.slice(0, 2)) {
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
          
          if (imageUrl.startsWith('http')) {
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
  const queryText = `${brand} ${model} ${year} motorcycle photo review`;
  console.log(`🔍 Scraping image search for: ${queryText}...`);
  return await scrapeImageForQuery(queryText);
}

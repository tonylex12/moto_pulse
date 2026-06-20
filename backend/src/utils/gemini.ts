export interface VehicleSpecs {
  tankSize: string | null;
  frontBrake: string | null;
  rearBrake: string | null;
  frontSuspension: string | null;
  rearSuspension: string | null;
  frontTire: string | null;
  rearTire: string | null;
  engineCc: string | null;
  power: string | null;
  torque: string | null;
  transmission: string | null;
  weight: string | null;
  seatHeight: string | null;
}

/**
 * Searches DuckDuckGo HTML interface and extracts technical specifications
 * using regex and basic text-matching rules.
 * This is 100% keyless, reliable, and does not require an AI API key.
 */
export async function fetchVehicleSpecs(brand: string, model: string, year: number): Promise<VehicleSpecs | null> {
  const queryText = `${brand} ${model} ${year} ficha tecnica especificaciones`;
  const query = encodeURIComponent(queryText);
  const url = `https://html.duckduckgo.com/html/?q=${query}`;

  console.log(`🔍 Scraping DuckDuckGo search results for: ${queryText}...`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      console.warn(`⚠️ DDG search failed with status ${response.status}. Returning empty specs.`);
      return null;
    }

    const html = await response.text();
    
    // Extract snippets from DDG HTML search results
    const snippets: string[] = [];
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = snippetRegex.exec(html)) !== null) {
      // Clean HTML tags and entities
      const text = match[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      snippets.push(text);
    }
    
    console.log(`🤖 Found ${snippets.length} web text snippets to parse.`);
    if (snippets.length === 0) {
      return null;
    }

    const combinedText = snippets.join(' | ');

    // Rule-based specification extraction
    const specs: VehicleSpecs = {
      engineCc: extractSpec(combinedText, [
        /(\d+(?:\.\d+)?)\s*(?:cc|c\.c\.|cm3|cilindrada)/i,
        /cilindrada\s*(?:de)?\s*(\d+(?:\.\d+)?)/i
      ], ' cc'),
      
      power: extractSpec(combinedText, [
        /(\d+(?:\.\d+)?)\s*(?:hp|cv|kw|caballos|bhp)/i,
        /potencia\s*(?:de)?\s*(\d+(?:\.\d+)?\s*(?:hp|cv|kw|caballos))/i
      ], ' HP'),
      
      torque: extractSpec(combinedText, [
        /(\d+(?:\.\d+)?)\s*(?:nm|n\.m|kgm)/i,
        /torque\s*(?:de)?\s*(\d+(?:\.\d+)?\s*(?:nm|n\.m))/i
      ], ' Nm'),
      
      transmission: extractSpec(combinedText, [
        /(semi-automatica|automatica|mecanica|manual)/i,
        /(\d+\s*velocidades|\d+\s*marchas|\d+\s*cambios)/i
      ], ''),
      
      tankSize: extractSpec(combinedText, [
        /(\d+(?:\.\d+)?)\s*(?:litros|l|gal|galones)\s*(?:de capacidad|en el tanque)?/i,
        /tanque\s*(?:de)?\s*(\d+(?:\.\d+)?\s*(?:litros|l|gal))/i
      ], ' Litros'),
      
      weight: extractSpec(combinedText, [
        /(\d+(?:\.\d+)?)\s*(?:kg|kilos|kilogramos)/i,
        /peso\s*(?:de)?\s*(\d+(?:\.\d+)?\s*kg)/i
      ], ' kg'),

      seatHeight: extractSpec(combinedText, [
        /altura\s*(?:del)?\s*asiento\s*(?:de)?\s*(\d+(?:\s*mm|\s*cm))/i,
        /asiento\s*(\d+\s*mm)/i,
        /(\d{3})\s*mm\s*(?:de altura de asiento|de altura al asiento)/i
      ], ' mm'),
      
      frontBrake: extractSpec(combinedText, [
        /(disco\s*(?:ventilado|lobulado|doble)?(?:\s*de\s*\d+\s*mm)?|tambor)/i
      ], ''),
      
      rearBrake: extractSpec(combinedText, [
        /(tambor|disco\s*(?:ventilado|lobulado)?(?:\s*de\s*\d+\s*mm)?)/i
      ], ''),

      frontSuspension: extractSpec(combinedText, [
        /(horquilla\s*(?:telescopica|invertida)?|amortiguador\s*delantero)/i
      ], ''),

      rearSuspension: extractSpec(combinedText, [
        /(monoshock|monoamortiguador|doble\s*amortiguador)/i
      ], ''),

      frontTire: extractSpec(combinedText, [
        /(\d{2,3}\/\d{2,3}-\d{2})/i,
        /(\d\.\d{2}-\d{2})/i
      ], ''),
      
      rearTire: extractSpec(combinedText, [
        /(\d{2,3}\/\d{2,3}-\d{2})/i
      ], '')
    };

    console.log('🤖 Web scraper successfully parsed specs:', JSON.stringify(specs, null, 2));
    return specs;
  } catch (error) {
    console.error('Error during scraping specs:', error);
    return null;
  }
}

function extractSpec(text: string, regexList: RegExp[], suffix: string): string | null {
  for (const regex of regexList) {
    const match = regex.exec(text);
    if (match && match[1]) {
      let val = match[1].trim();
      // Clean suffix
      if (suffix && !val.toLowerCase().includes(suffix.trim().toLowerCase())) {
        val = `${val}${suffix}`;
      }
      // Truncate overly long matched segments
      if (val.length > 50) {
        val = val.substring(0, 47) + '...';
      }
      return val;
    }
  }
  return null;
}

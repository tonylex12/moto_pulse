const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

function decodeHtmlEntities(str) {
  return str
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&Ntilde;/g, 'Ñ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchSnippetsFromDDG(queryText) {
  const query = encodeURIComponent(queryText);
  const url = `https://html.duckduckgo.com/html/?q=${query}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) return [];
    
    const html = await response.text();
    const snippets = [];
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = snippetRegex.exec(html)) !== null) {
      const text = decodeHtmlEntities(
        match[1]
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      );
      snippets.push(text);
    }
    return snippets;
  } catch (e) {
    console.warn(`DDG fetch failed:`, e.message);
    return [];
  }
}

async function fetchSnippetsFromYahoo(queryText) {
  const query = encodeURIComponent(queryText);
  const url = `https://search.yahoo.com/search?p=${query}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) return [];
    
    const html = await response.text();
    const snippets = [];
    const pRegex = /<p class="[^"]*fc-dustygray[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pRegex.exec(html)) !== null) {
      const text = decodeHtmlEntities(
        match[1]
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      );
      if (text.length > 10) {
        snippets.push(text);
      }
    }
    return snippets;
  } catch (e) {
    console.warn(`Yahoo fetch failed:`, e.message);
    return [];
  }
}

async function test() {
  const cases = [
    { brand: 'Honda', model: 'NX 190', year: 2026 },
    { brand: 'Yamaha', model: 'FZ25', year: 2024 },
    { brand: 'Honda', model: 'CB190R', year: 2023 }
  ];

  for (const c of cases) {
    console.log(`\n========================================`);
    console.log(`TEST CASE: ${c.brand} ${c.model} ${c.year}`);
    console.log(`========================================`);
    
    const queryText = `${c.brand} ${c.model} ${c.year} ficha tecnica especificaciones`;
    
    // Try DDG first
    let snippets = await fetchSnippetsFromDDG(queryText);
    console.log(`Fetched ${snippets.length} snippets from DDG.`);
    
    // Fallback to Yahoo if DDG returned nothing
    if (snippets.length === 0) {
      console.log(`DDG returned 0 results (possibly rate-limited). Falling back to Yahoo...`);
      snippets = await fetchSnippetsFromYahoo(queryText);
      console.log(`Fetched ${snippets.length} snippets from Yahoo.`);
    }

    snippets.forEach((s, i) => console.log(`  Snippet [${i}]: ${s}`));
    
    const specs = extractSpecsWithScoring(snippets);
    console.log('Parsed specs:');
    console.log(JSON.stringify(specs, null, 2));
    
    // Delay to avoid Yahoo/DDG rate limit
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
}

function getLocalContext(snippet, matchIndex, matchLength, windowSize = 60) {
  const start = Math.max(0, matchIndex - windowSize);
  const end = Math.min(snippet.length, matchIndex + matchLength + windowSize);
  return snippet.substring(start, end).toLowerCase();
}

function extractSpecsWithScoring(snippetsList) {
  const specs = {
    engineCc: null,
    power: null,
    torque: null,
    transmission: null,
    tankSize: null,
    weight: null,
    seatHeight: null,
    frontBrake: null,
    rearBrake: null,
    frontSuspension: null,
    rearSuspension: null,
    frontTire: null,
    rearTire: null
  };

  // --- 1. TANK SIZE ---
  let tankCandidates = [];
  const tankRegex = /(\b\d+(?:[\.,]\d+)?)\s*(?:litros|litro|l|gal|galones)\b/gi;
  snippetsList.forEach(snippet => {
    let match;
    const cleanSnippet = snippet.toLowerCase();
    tankRegex.lastIndex = 0;
    while ((match = tankRegex.exec(snippet)) !== null) {
      const rawVal = match[1].replace(',', '.');
      let val = parseFloat(rawVal);
      const unit = match[0].toLowerCase();
      if (isNaN(val)) continue;
      
      if (unit.includes('gal')) {
        val = val * 3.785;
      }

      let score = 0;
      const localCtx = getLocalContext(snippet, match.index, match[0].length, 50);
      
      if (cleanSnippet.includes('aceite') || cleanSnippet.includes('oil') || cleanSnippet.includes('lubricante') || cleanSnippet.includes('sae')) {
        score -= 30;
      }
      if (localCtx.includes('aceite') || localCtx.includes('oil') || localCtx.includes('sae') || localCtx.includes('horquilla') || localCtx.includes('transmision') || localCtx.includes('transmisión')) {
        score -= 20;
      }
      
      if (localCtx.includes('tanque') || localCtx.includes('deposito') || localCtx.includes('depósito') || localCtx.includes('combustible') || localCtx.includes('gasolina') || localCtx.includes('fuel')) {
        score += 30;
      } else if (cleanSnippet.includes('tanque') || cleanSnippet.includes('deposito') || cleanSnippet.includes('depósito') || cleanSnippet.includes('combustible')) {
        score += 15;
      }

      if (unit.includes('litro')) {
        score += 10;
      } else if (unit.includes('l')) {
        score += 2;
      }

      if (val >= 3 && val <= 25) {
        score += 15;
      } else if (val < 2 || val > 40) {
        score -= 15;
      }

      if (localCtx.includes('reserva')) {
        score -= 10;
      }

      tankCandidates.push({
        value: match[1] + (unit.includes('gal') ? ' Galones' : ' Litros'),
        score: score
      });
    }
  });
  if (tankCandidates.length > 0) {
    tankCandidates.sort((a, b) => b.score - a.score);
    specs.tankSize = tankCandidates[0].value;
  }

  // --- 2. TORQUE ---
  let torqueCandidates = [];
  const torqueRegex = /(\b\d+(?:[\.,]\d+)?)\s*(?:nm|n\.m|kgm|kgf\.?m)\b/gi;
  snippetsList.forEach(snippet => {
    let match;
    const cleanSnippet = snippet.toLowerCase();
    torqueRegex.lastIndex = 0;
    while ((match = torqueRegex.exec(snippet)) !== null) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (isNaN(val)) continue;
      const unit = match[0].toLowerCase();
      
      let score = 0;
      const localCtx = getLocalContext(snippet, match.index, match[0].length, 50);

      if (localCtx.includes('torque') || localCtx.includes('par') || localCtx.includes('empuje') || localCtx.includes('fuerza')) {
        score += 30;
      } else if (cleanSnippet.includes('torque') || cleanSnippet.includes('par')) {
        score += 15;
      }

      if (unit.includes('nm')) {
        score += 10;
        if (val >= 5 && val <= 200) score += 15;
      } else if (unit.includes('kg')) {
        score += 5;
        if (val >= 0.5 && val <= 20) score += 15;
      }

      torqueCandidates.push({
        value: match[1] + (unit.includes('kg') ? ' kgm' : ' Nm'),
        score: score
      });
    }
  });
  if (torqueCandidates.length > 0) {
    torqueCandidates.sort((a, b) => b.score - a.score);
    specs.torque = torqueCandidates[0].value;
  }

  // --- 3. POWER ---
  let powerCandidates = [];
  const powerRegex = /(\b\d+(?:[\.,]\d+)?)\s*(?:hp|cv|kw|caballos|bhp)\b/gi;
  snippetsList.forEach(snippet => {
    let match;
    const cleanSnippet = snippet.toLowerCase();
    powerRegex.lastIndex = 0;
    while ((match = powerRegex.exec(snippet)) !== null) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (isNaN(val)) continue;
      const unit = match[0].toLowerCase();

      let score = 0;
      const localCtx = getLocalContext(snippet, match.index, match[0].length, 50);

      if (localCtx.includes('potencia') || localCtx.includes('power') || localCtx.includes('caballos') || localCtx.includes('hp') || localCtx.includes('cv')) {
        score += 30;
      } else if (cleanSnippet.includes('potencia') || cleanSnippet.includes('power')) {
        score += 15;
      }

      if (val >= 5 && val <= 250) {
        score += 15;
      }

      powerCandidates.push({
        value: match[1] + ' HP',
        score: score
      });
    }
  });
  if (powerCandidates.length > 0) {
    powerCandidates.sort((a, b) => b.score - a.score);
    specs.power = powerCandidates[0].value;
  }

  // --- 4. ENGINE CC ---
  let engineCandidates = [];
  const ccRegex = /(\b\d+(?:[\.,]\d+)?)\s*(?:cc|c\.c\.|cm3)\b/gi;
  const ccLabelRegex = /(?:cilindrada|motor)\s*(?:de|:)?\s*(\b\d{2,4})\b/gi;
  snippetsList.forEach(snippet => {
    let match;
    const cleanSnippet = snippet.toLowerCase();
    
    ccRegex.lastIndex = 0;
    while ((match = ccRegex.exec(snippet)) !== null) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (isNaN(val)) continue;
      let score = 20;
      if (val >= 49 && val <= 2500) score += 15;
      engineCandidates.push({ value: match[1] + ' cc', score: score });
    }

    ccLabelRegex.lastIndex = 0;
    while ((match = ccLabelRegex.exec(snippet)) !== null) {
      const val = parseFloat(match[1]);
      if (isNaN(val)) continue;
      let score = 15;
      if (val >= 49 && val <= 2500) score += 15;
      engineCandidates.push({ value: match[1] + ' cc', score: score });
    }
  });
  if (engineCandidates.length > 0) {
    engineCandidates.sort((a, b) => b.score - a.score);
    specs.engineCc = engineCandidates[0].value;
  }

  // --- 5. WEIGHT ---
  let weightCandidates = [];
  const weightRegex = /(\b\d+(?:[\.,]\d+)?)\s*(?:kg|kilos|kilogramos)\b/gi;
  const weightLabelRegex = /peso\s*(?:de|:)?\s*(\b\d+(?:[\.,]\d+)?)\b/gi;
  snippetsList.forEach(snippet => {
    let match;
    const cleanSnippet = snippet.toLowerCase();

    weightRegex.lastIndex = 0;
    while ((match = weightRegex.exec(snippet)) !== null) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (isNaN(val)) continue;
      let score = 10;
      const localCtx = getLocalContext(snippet, match.index, match[0].length, 50);
      if (localCtx.includes('peso') || localCtx.includes('weight') || localCtx.includes('orden de marcha') || localCtx.includes('vacío') || localCtx.includes('vacio') || localCtx.includes('seco')) {
        score += 25;
      }
      if (val >= 50 && val <= 400) score += 15;
      weightCandidates.push({ value: match[1] + ' kg', score: score });
    }

    weightLabelRegex.lastIndex = 0;
    while ((match = weightLabelRegex.exec(snippet)) !== null) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (isNaN(val)) continue;
      let score = 15;
      if (val >= 50 && val <= 400) score += 15;
      weightCandidates.push({ value: match[1] + ' kg', score: score });
    }
  });
  if (weightCandidates.length > 0) {
    weightCandidates.sort((a, b) => b.score - a.score);
    specs.weight = weightCandidates[0].value;
  }

  // --- 6. SEAT HEIGHT ---
  let seatHeightCandidates = [];
  const mmRegex = /(\b\d{3})\s*mm\b/gi;
  snippetsList.forEach(snippet => {
    let match;
    const cleanSnippet = snippet.toLowerCase();
    mmRegex.lastIndex = 0;
    while ((match = mmRegex.exec(snippet)) !== null) {
      const val = parseInt(match[1], 10);
      if (isNaN(val)) continue;

      let score = 0;
      const localCtx = getLocalContext(snippet, match.index, match[0].length, 50);

      if (localCtx.includes('asiento') || localCtx.includes('seat')) {
        score += 30;
      } else if (cleanSnippet.includes('asiento')) {
        score += 10;
      }

      if (localCtx.includes('altura') || localCtx.includes('height')) {
        score += 15;
      }

      if (val >= 600 && val <= 1000) {
        score += 15;
      } else {
        score -= 30;
      }

      if (localCtx.includes('disco') || localCtx.includes('freno') || localCtx.includes('suspension') || localCtx.includes('suspensión') || localCtx.includes('recorrido') || localCtx.includes('delantero') || localCtx.includes('trasero')) {
        score -= 15;
      }

      seatHeightCandidates.push({
        value: match[1] + ' mm',
        score: score
      });
    }
  });
  if (seatHeightCandidates.length > 0) {
    seatHeightCandidates.sort((a, b) => b.score - a.score);
    if (seatHeightCandidates[0].score > 0) {
      specs.seatHeight = seatHeightCandidates[0].value;
    }
  }

  // --- 7. TRANSMISSION ---
  let transCandidates = [];
  snippetsList.forEach(snippet => {
    const cleanSnippet = snippet.toLowerCase();
    let match;
    
    const transRegex1 = /(semi-automatica|automatica|mecanica|manual)/gi;
    transRegex1.lastIndex = 0;
    while ((match = transRegex1.exec(snippet)) !== null) {
      transCandidates.push({ value: match[0], score: 10 });
    }

    const transRegex2 = /(\d+\s*(?:velocidades|marchas|cambios|vel))/gi;
    transRegex2.lastIndex = 0;
    while ((match = transRegex2.exec(snippet)) !== null) {
      transCandidates.push({ value: match[0], score: 20 });
    }
  });
  if (transCandidates.length > 0) {
    transCandidates.sort((a, b) => b.score - a.score);
    specs.transmission = transCandidates[0].value;
  }

  // --- 8 & 9. BRAKES ---
  let brakeCandidates = [];
  const brakeRegex = /(disco\s*(?:ventilado|lobulado|doble)?(?:\s*de\s*\d+\s*mm)?|tambor)/gi;
  snippetsList.forEach(snippet => {
    let match;
    brakeRegex.lastIndex = 0;
    while ((match = brakeRegex.exec(snippet)) !== null) {
      const localCtx = getLocalContext(snippet, match.index, match[0].length, 50);
      brakeCandidates.push({
        value: match[0],
        index: match.index,
        localCtx: localCtx
      });
    }
  });

  if (brakeCandidates.length > 0) {
    const frontCandidates = brakeCandidates.map(c => {
      let score = 0;
      if (c.localCtx.includes('delantero') || c.localCtx.includes('delantera') || c.localCtx.includes('front')) score += 30;
      if (c.localCtx.includes('trasero') || c.localCtx.includes('trasera') || c.localCtx.includes('rear')) score -= 20;
      if (c.value.includes('276') || c.value.includes('300') || c.value.includes('310') || c.value.includes('320')) score += 5;
      return { value: c.value, score };
    }).sort((a, b) => b.score - a.score);
    specs.frontBrake = frontCandidates[0].value;

    const rearCandidates = brakeCandidates.map(c => {
      let score = 0;
      if (c.localCtx.includes('trasero') || c.localCtx.includes('trasera') || c.localCtx.includes('rear')) score += 30;
      if (c.localCtx.includes('delantero') || c.localCtx.includes('delantera') || c.localCtx.includes('front')) score -= 20;
      if (c.value.includes('220') || c.value.includes('240') || c.value.includes('tambor')) score += 5;
      return { value: c.value, score };
    }).sort((a, b) => b.score - a.score);
    specs.rearBrake = rearCandidates[0].value;
  }

  // --- 10 & 11. SUSPENSIONS ---
  let suspensionCandidates = [];
  const suspRegex = /(horquilla\s*(?:telescopica|invertida|telescópica)?|amortiguador\s*delantero|suspension\s*delantera|suspensión\s*delantera|monoshock|monoamortiguador|doble\s*amortiguador|suspension\s*trasera|suspensión\s*trasera)/gi;
  snippetsList.forEach(snippet => {
    let match;
    suspRegex.lastIndex = 0;
    while ((match = suspRegex.exec(snippet)) !== null) {
      const localCtx = getLocalContext(snippet, match.index, match[0].length, 50);
      suspensionCandidates.push({
        value: match[0],
        localCtx: localCtx
      });
    }
  });

  if (suspensionCandidates.length > 0) {
    const frontSusp = suspensionCandidates.map(c => {
      let score = 0;
      if (c.value.toLowerCase().includes('horquilla') || c.value.toLowerCase().includes('delantera') || c.localCtx.includes('delantero') || c.localCtx.includes('delantera') || c.localCtx.includes('front')) score += 20;
      if (c.value.toLowerCase().includes('monoshock') || c.value.toLowerCase().includes('trasera') || c.localCtx.includes('trasero') || c.localCtx.includes('trasera') || c.localCtx.includes('rear')) score -= 20;
      return { value: c.value, score };
    }).sort((a, b) => b.score - a.score);
    specs.frontSuspension = frontSusp[0].score >= 0 ? frontSusp[0].value : null;

    const rearSusp = suspensionCandidates.map(c => {
      let score = 0;
      if (c.value.toLowerCase().includes('monoshock') || c.value.toLowerCase().includes('monoamortiguador') || c.value.toLowerCase().includes('trasera') || c.localCtx.includes('trasero') || c.localCtx.includes('trasera') || c.localCtx.includes('rear')) score += 20;
      if (c.value.toLowerCase().includes('horquilla') || c.value.toLowerCase().includes('delantera') || c.localCtx.includes('delantero') || c.localCtx.includes('delantera') || c.localCtx.includes('front')) score -= 20;
      return { value: c.value, score };
    }).sort((a, b) => b.score - a.score);
    specs.rearSuspension = rearSusp[0].score >= 0 ? rearSusp[0].value : null;
  }

  // --- 12 & 13. TIRES ---
  let tireCandidates = [];
  const tireRegex = /(\d{2,3}\/\d{2,3}[-\s]*\d{2})/gi;
  snippetsList.forEach(snippet => {
    let match;
    tireRegex.lastIndex = 0;
    while ((match = tireRegex.exec(snippet)) !== null) {
      const localCtx = getLocalContext(snippet, match.index, match[0].length, 50);
      tireCandidates.push({
        value: match[0],
        index: match.index,
        localCtx: localCtx
      });
    }
  });

  if (tireCandidates.length > 0) {
    const frontTires = tireCandidates.map(c => {
      let score = 0;
      if (c.localCtx.includes('delantero') || c.localCtx.includes('delantera') || c.localCtx.includes('front') || c.localCtx.includes('del')) score += 20;
      if (c.localCtx.includes('trasero') || c.localCtx.includes('trasera') || c.localCtx.includes('rear') || c.localCtx.includes('tras')) score -= 20;
      return { value: c.value, index: c.index, score };
    }).sort((a, b) => b.score - a.score);
    
    const rearTires = tireCandidates.map(c => {
      let score = 0;
      if (c.localCtx.includes('trasero') || c.localCtx.includes('trasera') || c.localCtx.includes('rear') || c.localCtx.includes('tras')) score += 20;
      if (c.localCtx.includes('delantero') || c.localCtx.includes('delantera') || c.localCtx.includes('front') || c.localCtx.includes('del')) score -= 20;
      return { value: c.value, index: c.index, score };
    }).sort((a, b) => b.score - a.score);

    if (frontTires[0].score === 0 && rearTires[0].score === 0 && tireCandidates.length >= 2) {
      const sortedByOccur = [...tireCandidates].sort((a, b) => a.index - b.index);
      specs.frontTire = sortedByOccur[0].value;
      specs.rearTire = sortedByOccur[1].value;
    } else {
      specs.frontTire = frontTires[0].value;
      specs.rearTire = rearTires[0].score > rearTires[0].score ? rearTires[0].value : rearTires.find(t => t.value !== specs.frontTire)?.value || rearTires[0].value;
    }
  }

  return specs;
}

test();

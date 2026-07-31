package scraper

import (
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type VehicleSpecs struct {
	TankSize        *string `json:"tankSize"`
	FrontBrake      *string `json:"frontBrake"`
	RearBrake       *string `json:"rearBrake"`
	FrontSuspension *string `json:"frontSuspension"`
	RearSuspension  *string `json:"rearSuspension"`
	FrontTire       *string `json:"frontTire"`
	RearTire        *string `json:"rearTire"`
	EngineCc        *string `json:"engineCc"`
	Power           *string `json:"power"`
	Torque          *string `json:"torque"`
	Transmission    *string `json:"transmission"`
	Weight          *string `json:"weight"`
	SeatHeight      *string `json:"seatHeight"`
}

func splitNonAlphanumeric(s string) []string {
	var words []string
	var current []rune
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			current = append(current, r)
		} else {
			if len(current) > 0 {
				words = append(words, strings.ToLower(string(current)))
				current = nil
			}
		}
	}
	if len(current) > 0 {
		words = append(words, strings.ToLower(string(current)))
	}
	return words
}

func getLocalContext(snippet string, matchStart, matchEnd, windowSize int) string {
	start := matchStart - windowSize
	if start < 0 {
		start = 0
	}
	end := matchEnd + windowSize
	if end > len(snippet) {
		end = len(snippet)
	}
	return strings.ToLower(snippet[start:end])
}

func isSnippetRelevantToModel(snippet, brand, model string) bool {
	_ = brand
	lowerSnippet := strings.ToLower(snippet)
	lowerModel := strings.ToLower(model)
	
	cleanModel := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return -1
	}, lowerModel)

	if strings.Contains(lowerSnippet, cleanModel) {
		return true
	}

	modelWords := splitNonAlphanumeric(lowerModel)
	if len(modelWords) > 0 {
		allMatch := true
		for _, word := range modelWords {
			if !strings.Contains(lowerSnippet, word) {
				allMatch = false
				break
			}
		}
		if allMatch {
			return true
		}
	}

	// Also split letters and numbers (e.g. "nx190" -> "nx", "190") to match snippets containing "NX 190"
	reLettersNumbers := regexp.MustCompile(`([a-zA-Z]+)|(\d+)`)
	matchesLettersNumbers := reLettersNumbers.FindAllString(lowerModel, -1)
	if len(matchesLettersNumbers) > 1 {
		allMatch := true
		for _, w := range matchesLettersNumbers {
			if !strings.Contains(lowerSnippet, w) {
				allMatch = false
				break
			}
		}
		if allMatch {
			return true
		}
	}

	// Restrict prefix to 2-4 letters to prevent matching long words like "combustible" or "autonomia"
	codeRegex := regexp.MustCompile(`\b([a-z]{2,4})[-_/\s]?\d+[a-z]*\b`)
	matches := codeRegex.FindAllStringSubmatch(lowerSnippet, -1)
	
	// Spanish/English common prepositions/words to exclude from being treated as code prefixes
	stopWords := map[string]bool{
		"de":   true,
		"en":   true,
		"la":   true,
		"el":   true,
		"un":   true,
		"al":   true,
		"del":  true,
		"los":  true,
		"con":  true,
		"por":  true,
		"para": true,
		"una":  true,
		"las":  true,
		"no":   true,
		"si":   true,
		"es":   true,
		"su":   true,
		"in":   true,
		"at":   true,
		"of":   true,
		"to":   true,
		"by":   true,
		"on":   true,
		"an":   true,
		"it":   true,
		"as":   true,
		"or":   true,
	}

	foundConflict := false
	for _, m := range matches {
		prefix := m[1]
		if stopWords[prefix] {
			continue // skip false positives like "de 680" or "en 2026"
		}
		
		code := m[0]
		cleanCode := strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
				return r
			}
			return -1
		}, code)
		if cleanCode != cleanModel {
			if strings.HasPrefix(cleanCode, cleanModel) || strings.HasPrefix(cleanModel, cleanCode) {
				continue
			}
			foundConflict = true
		}
	}

	if foundConflict {
		return strings.Contains(lowerSnippet, cleanModel)
	}

	return true
}

func fetchSnippetsFromDDG(queryText string) ([]string, error) {
	query := url.QueryEscape(queryText)
	targetURL := fmt.Sprintf("https://html.duckduckgo.com/html/?q=%s", query)
	
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("duckduckgo returned status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	htmlContent := string(bodyBytes)

	var snippets []string
	snippetRegex := regexp.MustCompile(`<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>`)
	htmlTagRegex := regexp.MustCompile(`<[^>]*>`)
	spaceRegex := regexp.MustCompile(`\s+`)

	matches := snippetRegex.FindAllStringSubmatch(htmlContent, -1)
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		text := html.UnescapeString(m[1])
		text = htmlTagRegex.ReplaceAllString(text, "")
		text = spaceRegex.ReplaceAllString(text, " ")
		text = strings.TrimSpace(text)
		snippets = append(snippets, text)
	}

	return snippets, nil
}

func fetchSnippetsFromYahoo(queryText string) ([]string, error) {
	query := url.QueryEscape(queryText)
	targetURL := fmt.Sprintf("https://search.yahoo.com/search?p=%s", query)

	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo returned status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	htmlContent := string(bodyBytes)

	var snippets []string
	pRegex := regexp.MustCompile(`(?i)<p class="[^"]*fc-dustygray[^"]*"[^>]*>([\s\S]*?)<\/p>`)
	divRegex := regexp.MustCompile(`(?i)<div class="[^"]*compText[^"]*"[^>]*>([\s\S]*?)<\/div>`)
	htmlTagRegex := regexp.MustCompile(`<[^>]*>`)
	spaceRegex := regexp.MustCompile(`\s+`)

	pMatches := pRegex.FindAllStringSubmatch(htmlContent, -1)
	for _, m := range pMatches {
		if len(m) < 2 {
			continue
		}
		text := html.UnescapeString(m[1])
		text = htmlTagRegex.ReplaceAllString(text, "")
		text = spaceRegex.ReplaceAllString(text, " ")
		text = strings.TrimSpace(text)
		if len(text) > 10 {
			snippets = append(snippets, text)
		}
	}

	divMatches := divRegex.FindAllStringSubmatch(htmlContent, -1)
	for _, m := range divMatches {
		if len(m) < 2 {
			continue
		}
		text := html.UnescapeString(m[1])
		text = htmlTagRegex.ReplaceAllString(text, "")
		text = spaceRegex.ReplaceAllString(text, " ")
		text = strings.TrimSpace(text)
		
		// Avoid duplicate snippets
		alreadyAdded := false
		for _, s := range snippets {
			if s == text {
				alreadyAdded = true
				break
			}
		}
		if len(text) > 10 && !alreadyAdded {
			snippets = append(snippets, text)
		}
	}

	return snippets, nil
}

type candidate struct {
	value string
	score int
}

func extractSpecsWithScoring(snippetsList []string) VehicleSpecs {
	var specs VehicleSpecs

	if len(snippetsList) == 0 {
		return specs
	}

	// 1. TANK SIZE
	var tankCandidates []candidate
	tankRegex := regexp.MustCompile(`(?i)(\b\d+(?:[\.,]\d+)?)\s*(?:litros|litro|lts|l|gal|galones)\b`)
	for _, snippet := range snippetsList {
		matches := tankRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range matches {
			if len(loc) < 4 {
				continue
			}
			valStr := strings.Replace(snippet[loc[2]:loc[3]], ",", ".", 1)
			val, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				continue
			}
			unit := strings.ToLower(snippet[loc[0]:loc[1]])
			if strings.Contains(unit, "gal") {
				val = val * 3.785
			}

			score := 0
			cleanSnippet := strings.ToLower(snippet)
			localCtx := getLocalContext(snippet, loc[0], loc[1], 50)

			if strings.Contains(cleanSnippet, "aceite") || strings.Contains(cleanSnippet, "oil") || strings.Contains(cleanSnippet, "lubricante") || strings.Contains(cleanSnippet, "sae") {
				score -= 30
			}
			if strings.Contains(localCtx, "aceite") || strings.Contains(localCtx, "oil") || strings.Contains(localCtx, "sae") || strings.Contains(localCtx, "horquilla") || strings.Contains(localCtx, "transmision") || strings.Contains(localCtx, "transmisión") {
				score -= 20
			}
			if strings.Contains(localCtx, "tanque") || strings.Contains(localCtx, "deposito") || strings.Contains(localCtx, "depósito") || strings.Contains(localCtx, "combustible") || strings.Contains(localCtx, "gasolina") || strings.Contains(localCtx, "fuel") {
				score += 30
			} else if strings.Contains(cleanSnippet, "tanque") || strings.Contains(cleanSnippet, "deposito") || strings.Contains(cleanSnippet, "depósito") || strings.Contains(cleanSnippet, "combustible") {
				score += 15
			}

			if strings.Contains(unit, "litro") {
				score += 10
			} else if strings.Contains(unit, "l") {
				score += 2
			}

			if val >= 3 && val <= 25 {
				score += 15
			} else if val < 2 || val > 40 {
				score -= 15
			}

			if strings.Contains(localCtx, "reserva") {
				score -= 10
			}

			displayVal := fmt.Sprintf("%s Litros", valStr)
			if strings.Contains(unit, "gal") {
				displayVal = fmt.Sprintf("%s Galones", valStr)
			}
			tankCandidates = append(tankCandidates, candidate{value: displayVal, score: score})
		}
	}
	if len(tankCandidates) > 0 {
		sort.Slice(tankCandidates, func(i, j int) bool {
			return tankCandidates[i].score > tankCandidates[j].score
		})
		specs.TankSize = &tankCandidates[0].value
	}

	// 2. TORQUE
	var torqueCandidates []candidate
	torqueRegex := regexp.MustCompile(`(?i)(\b\d+(?:[\.,]\d+)?)\s*(?:nm|n\.m|n-m|n\s*-\s*m|kgm|kgf\.?m|kgf-m)\b`)
	for _, snippet := range snippetsList {
		matches := torqueRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range matches {
			if len(loc) < 4 {
				continue
			}
			valStr := strings.Replace(snippet[loc[2]:loc[3]], ",", ".", 1)
			val, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				continue
			}
			unit := strings.ToLower(snippet[loc[0]:loc[1]])

			score := 0
			cleanSnippet := strings.ToLower(snippet)
			localCtx := getLocalContext(snippet, loc[0], loc[1], 50)

			if strings.Contains(localCtx, "torque") || strings.Contains(localCtx, "par") || strings.Contains(localCtx, "empuje") || strings.Contains(localCtx, "fuerza") {
				score += 30
			} else if strings.Contains(cleanSnippet, "torque") || strings.Contains(cleanSnippet, "par") {
				score += 15
			}

			if strings.Contains(unit, "nm") || strings.Contains(unit, "n-m") || strings.Contains(unit, "n.m") {
				score += 10
				if val >= 5 && val <= 200 {
					score += 15
				}
			} else if strings.Contains(unit, "kg") {
				score += 5
				if val >= 0.5 && val <= 20 {
					score += 15
				}
			}

			displayVal := valStr + " Nm"
			if strings.Contains(unit, "kg") {
				displayVal = valStr + " kgm"
			}
			torqueCandidates = append(torqueCandidates, candidate{value: displayVal, score: score})
		}
	}
	if len(torqueCandidates) > 0 {
		sort.Slice(torqueCandidates, func(i, j int) bool {
			return torqueCandidates[i].score > torqueCandidates[j].score
		})
		specs.Torque = &torqueCandidates[0].value
	}

	// 3. POWER
	var powerCandidates []candidate
	powerRegex := regexp.MustCompile(`(?i)(\b\d+(?:[\.,]\d+)?)\s*(?:hp|cv|kw|caballos|bhp)\b`)
	for _, snippet := range snippetsList {
		matches := powerRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range matches {
			if len(loc) < 4 {
				continue
			}
			valStr := strings.Replace(snippet[loc[2]:loc[3]], ",", ".", 1)
			val, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				continue
			}

			score := 0
			cleanSnippet := strings.ToLower(snippet)
			localCtx := getLocalContext(snippet, loc[0], loc[1], 50)

			if strings.Contains(localCtx, "potencia") || strings.Contains(localCtx, "power") || strings.Contains(localCtx, "caballos") || strings.Contains(localCtx, "hp") || strings.Contains(localCtx, "cv") {
				score += 30
			} else if strings.Contains(cleanSnippet, "potencia") || strings.Contains(cleanSnippet, "power") {
				score += 15
			}

			if val >= 5 && val <= 250 {
				score += 15
			}

			powerCandidates = append(powerCandidates, candidate{value: valStr + " HP", score: score})
		}
	}
	if len(powerCandidates) > 0 {
		sort.Slice(powerCandidates, func(i, j int) bool {
			return powerCandidates[i].score > powerCandidates[j].score
		})
		specs.Power = &powerCandidates[0].value
	}

	// 4. ENGINE CC
	var engineCandidates []candidate
	ccRegex := regexp.MustCompile(`(?i)(\b\d+(?:[\.,]\d+)?)\s*(?:cc\b|c\.c\.|cm3\b|cm³)`)
	ccLabelRegex := regexp.MustCompile(`(?i)(?:cilindrada|motor)\s*(?:de|:)?\s*(\b\d{2,4})\b`)
	for _, snippet := range snippetsList {
		ccMatches := ccRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range ccMatches {
			if len(loc) < 4 {
				continue
			}
			valStr := strings.Replace(snippet[loc[2]:loc[3]], ",", ".", 1)
			val, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				continue
			}
			score := 20
			if val >= 49 && val <= 2500 {
				score += 15
			}
			engineCandidates = append(engineCandidates, candidate{value: valStr + " cc", score: score})
		}

		labelMatches := ccLabelRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range labelMatches {
			if len(loc) < 4 {
				continue
			}
			valStr := snippet[loc[2]:loc[3]]
			val, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				continue
			}
			score := 15
			if val >= 49 && val <= 2500 {
				score += 15
			}
			engineCandidates = append(engineCandidates, candidate{value: valStr + " cc", score: score})
		}
	}
	if len(engineCandidates) > 0 {
		sort.Slice(engineCandidates, func(i, j int) bool {
			return engineCandidates[i].score > engineCandidates[j].score
		})
		specs.EngineCc = &engineCandidates[0].value
	}

	// 5. WEIGHT
	var weightCandidates []candidate
	weightRegex := regexp.MustCompile(`(?i)(\b\d+(?:[\.,]\d+)?)\s*(?:kg|kgs|kilos|kilogramos)\b`)
	weightLabelRegex := regexp.MustCompile(`(?i)peso\s*(?:de|:)?\s*(\b\d+(?:[\.,]\d+)?)\b`)
	for _, snippet := range snippetsList {
		matches := weightRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range matches {
			if len(loc) < 4 {
				continue
			}
			valStr := strings.Replace(snippet[loc[2]:loc[3]], ",", ".", 1)
			val, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				continue
			}
			if val < 95.0 {
				continue // Enforce minimum weight of 95 kg to prevent parsing driver's weight (e.g. 75 kg)
			}
			score := 10
			localCtx := getLocalContext(snippet, loc[0], loc[1], 50)
			if strings.Contains(localCtx, "peso") || strings.Contains(localCtx, "weight") || strings.Contains(localCtx, "orden de marcha") || strings.Contains(localCtx, "vacío") || strings.Contains(localCtx, "vacio") || strings.Contains(localCtx, "seco") {
				score += 25
			}
			if val >= 95 && val <= 400 {
				score += 15
			}
			weightCandidates = append(weightCandidates, candidate{value: valStr + " kg", score: score})
		}

		lblMatches := weightLabelRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range lblMatches {
			if len(loc) < 4 {
				continue
			}
			valStr := strings.Replace(snippet[loc[2]:loc[3]], ",", ".", 1)
			val, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				continue
			}
			if val < 95.0 {
				continue // Enforce minimum weight of 95 kg to prevent parsing driver's weight (e.g. 75 kg)
			}
			score := 15
			if val >= 95 && val <= 400 {
				score += 15
			}
			weightCandidates = append(weightCandidates, candidate{value: valStr + " kg", score: score})
		}
	}
	if len(weightCandidates) > 0 {
		sort.Slice(weightCandidates, func(i, j int) bool {
			return weightCandidates[i].score > weightCandidates[j].score
		})
		specs.Weight = &weightCandidates[0].value
	}

	// 6. SEAT HEIGHT
	var seatHeightCandidates []candidate
	seatHeightRegex := regexp.MustCompile(`(?i)(\b\d{2,3}(?:[\.,]\d+)?)\s*(?:mm|cm)\b`)
	for _, snippet := range snippetsList {
		matches := seatHeightRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range matches {
			if len(loc) < 4 {
				continue
			}
			valStr := strings.Replace(snippet[loc[2]:loc[3]], ",", ".", 1)
			valFloat, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				continue
			}
			val := int(valFloat)
			unit := strings.ToLower(snippet[loc[0]:loc[1]])
			if strings.Contains(unit, "cm") {
				val = val * 10
			}

			score := 0
			cleanSnippet := strings.ToLower(snippet)
			localCtx := getLocalContext(snippet, loc[0], loc[1], 50)

			if strings.Contains(localCtx, "asiento") || strings.Contains(localCtx, "seat") {
				score += 30
			} else if strings.Contains(cleanSnippet, "asiento") {
				score += 10
			}

			if strings.Contains(localCtx, "altura") || strings.Contains(localCtx, "height") {
				score += 15
			}

			if val >= 600 && val <= 1000 {
				score += 15
			} else {
				score -= 30
			}

			if strings.Contains(localCtx, "disco") || strings.Contains(localCtx, "freno") || strings.Contains(localCtx, "suspension") || strings.Contains(localCtx, "suspensión") || strings.Contains(localCtx, "recorrido") || strings.Contains(localCtx, "delantero") || strings.Contains(localCtx, "trasero") {
				score -= 15
			}

			displayVal := fmt.Sprintf("%d mm", val)
			seatHeightCandidates = append(seatHeightCandidates, candidate{value: displayVal, score: score})
		}
	}
	if len(seatHeightCandidates) > 0 {
		sort.Slice(seatHeightCandidates, func(i, j int) bool {
			return seatHeightCandidates[i].score > seatHeightCandidates[j].score
		})
		if seatHeightCandidates[0].score > 0 {
			specs.SeatHeight = &seatHeightCandidates[0].value
		}
	}

	// 7. TRANSMISSION
	var transCandidates []candidate
	transRegex1 := regexp.MustCompile(`(?i)(semi-automatica|automatica|mecanica|manual)`)
	transRegex2 := regexp.MustCompile(`(?i)(\d+\s*(?:velocidades|marchas|cambios|vel))`)
	for _, snippet := range snippetsList {
		matches1 := transRegex1.FindAllString(snippet, -1)
		for _, m := range matches1 {
			transCandidates = append(transCandidates, candidate{value: m, score: 10})
		}

		matches2 := transRegex2.FindAllString(snippet, -1)
		for _, m := range matches2 {
			transCandidates = append(transCandidates, candidate{value: m, score: 20})
		}
	}
	if len(transCandidates) > 0 {
		sort.Slice(transCandidates, func(i, j int) bool {
			return transCandidates[i].score > transCandidates[j].score
		})
		specs.Transmission = &transCandidates[0].value
	}

	// 8 & 9. BRAKES
	type contextItem struct {
		value    string
		index    int
		localCtx string
	}
	var brakeCandidates []contextItem
	brakeRegex := regexp.MustCompile(`(?i)(disco\s*(?:ventilado|lobulado|doble)?(?:\s*de\s*\d+\s*mm)?|tambor)`)
	for _, snippet := range snippetsList {
		matches := brakeRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range matches {
			localCtx := getLocalContext(snippet, loc[0], loc[1], 50)
			brakeCandidates = append(brakeCandidates, contextItem{
				value:    snippet[loc[0]:loc[1]],
				index:    loc[0],
				localCtx: localCtx,
			})
		}
	}
	if len(brakeCandidates) > 0 {
		var frontBrakes []candidate
		var rearBrakes []candidate

		for _, c := range brakeCandidates {
			fScore := 0
			if strings.Contains(c.localCtx, "delantero") || strings.Contains(c.localCtx, "delantera") || strings.Contains(c.localCtx, "front") {
				fScore += 30
			}
			if strings.Contains(c.localCtx, "trasero") || strings.Contains(c.localCtx, "trasera") || strings.Contains(c.localCtx, "rear") {
				fScore -= 20
			}
			lowerVal := strings.ToLower(c.value)
			if strings.Contains(lowerVal, "276") || strings.Contains(lowerVal, "300") || strings.Contains(lowerVal, "310") || strings.Contains(lowerVal, "320") {
				fScore += 5
			}
			frontBrakes = append(frontBrakes, candidate{value: c.value, score: fScore})

			rScore := 0
			if strings.Contains(c.localCtx, "trasero") || strings.Contains(c.localCtx, "trasera") || strings.Contains(c.localCtx, "rear") {
				rScore += 30
			}
			if strings.Contains(c.localCtx, "delantero") || strings.Contains(c.localCtx, "delantera") || strings.Contains(c.localCtx, "front") {
				rScore -= 20
			}
			if strings.Contains(lowerVal, "220") || strings.Contains(lowerVal, "240") || strings.Contains(lowerVal, "tambor") {
				rScore += 5
			}
			rearBrakes = append(rearBrakes, candidate{value: c.value, score: rScore})
		}

		sort.Slice(frontBrakes, func(i, j int) bool { return frontBrakes[i].score > frontBrakes[j].score })
		sort.Slice(rearBrakes, func(i, j int) bool { return rearBrakes[i].score > rearBrakes[j].score })

		specs.FrontBrake = &frontBrakes[0].value
		specs.RearBrake = &rearBrakes[0].value
	}

	// 10 & 11. SUSPENSIONS
	var suspensionCandidates []contextItem
	suspRegex := regexp.MustCompile(`(?i)(suspensión\s+delantera|suspension\s+delantera|horquilla\s+telescópica|horquilla\s+telescopica|horquilla\s+invertida|horquilla|suspensión\s+trasera|suspension\s+trasera|monoshock|mono\s+shock|mono-shock|monoamortiguador|amortiguador\s+trasero|amortiguadores\s+traseros|doble\s+amortiguador)\s*([^,\.;\n]*)`)
	seenSusp := make(map[string]bool)

	for _, snippet := range snippetsList {
		matches := suspRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range matches {
			if len(loc) >= 6 {
				keyword := snippet[loc[2]:loc[3]]
				remainder := snippet[loc[4]:loc[5]]
				cleaned := cleanDescription(keyword, remainder)
				
				if seenSusp[strings.ToLower(cleaned)] {
					continue
				}
				seenSusp[strings.ToLower(cleaned)] = true

				localCtx := getLocalContext(snippet, loc[0], loc[1], 50)
				suspensionCandidates = append(suspensionCandidates, contextItem{
					value:    cleaned,
					index:    loc[0],
					localCtx: localCtx,
				})
			}
		}
	}
	if len(suspensionCandidates) > 0 {
		var frontSusp []candidate
		var rearSusp []candidate

		for _, c := range suspensionCandidates {
			lowerVal := strings.ToLower(c.value)
			
			hasFrontIndicators := strings.Contains(lowerVal, "horquilla") || strings.Contains(lowerVal, "barras") || strings.Contains(lowerVal, "delantera") || strings.Contains(lowerVal, "front")
			hasRearIndicators := strings.Contains(lowerVal, "monoshock") || strings.Contains(lowerVal, "mono shock") || strings.Contains(lowerVal, "mono-shock") || strings.Contains(lowerVal, "monoamortiguador") || strings.Contains(lowerVal, "pro-link") || strings.Contains(lowerVal, "pro link") || strings.Contains(lowerVal, "trasera") || strings.Contains(lowerVal, "trasero") || strings.Contains(lowerVal, "rear") || strings.Contains(lowerVal, "doble amortiguador")

			fScore := 0
			if hasFrontIndicators && !hasRearIndicators {
				fScore += 100
			} else if hasRearIndicators && !hasFrontIndicators {
				fScore -= 100
			} else {
				if strings.Contains(c.localCtx, "delantero") || strings.Contains(c.localCtx, "delantera") || strings.Contains(c.localCtx, "front") {
					fScore += 20
				}
				if strings.Contains(c.localCtx, "trasero") || strings.Contains(c.localCtx, "trasera") || strings.Contains(c.localCtx, "rear") {
					fScore -= 20
				}
			}
			frontSusp = append(frontSusp, candidate{value: c.value, score: fScore})

			rScore := 0
			if hasRearIndicators && !hasFrontIndicators {
				rScore += 100
			} else if hasFrontIndicators && !hasRearIndicators {
				rScore -= 100
			} else {
				if strings.Contains(c.localCtx, "trasero") || strings.Contains(c.localCtx, "trasera") || strings.Contains(c.localCtx, "rear") {
					rScore += 20
				}
				if strings.Contains(c.localCtx, "delantero") || strings.Contains(c.localCtx, "delantera") || strings.Contains(c.localCtx, "front") {
					rScore -= 20
				}
			}
			rearSusp = append(rearSusp, candidate{value: c.value, score: rScore})
		}

		sort.Slice(frontSusp, func(i, j int) bool { return frontSusp[i].score > frontSusp[j].score })
		sort.Slice(rearSusp, func(i, j int) bool { return rearSusp[i].score > rearSusp[j].score })

		if len(frontSusp) > 0 && frontSusp[0].score >= 0 {
			specs.FrontSuspension = &frontSusp[0].value
		}
		if len(rearSusp) > 0 && rearSusp[0].score >= 0 {
			specs.RearSuspension = &rearSusp[0].value
		}
	}

	// 12 & 13. TIRES
	var tireCandidates []contextItem
	tireRegex := regexp.MustCompile(`(?i)(\d{2,3}\/\d{2,3}[-\s]*\d{2})`)
	for _, snippet := range snippetsList {
		matches := tireRegex.FindAllStringSubmatchIndex(snippet, -1)
		for _, loc := range matches {
			localCtx := getLocalContext(snippet, loc[0], loc[1], 50)
			tireCandidates = append(tireCandidates, contextItem{
				value:    snippet[loc[0]:loc[1]],
				index:    loc[0],
				localCtx: localCtx,
			})
		}
	}
	if len(tireCandidates) > 0 {
		var frontTires []candidate
		var rearTires []candidate

		for _, c := range tireCandidates {
			fScore := 0
			if strings.Contains(c.localCtx, "delantero") || strings.Contains(c.localCtx, "delantera") || strings.Contains(c.localCtx, "front") || strings.Contains(c.localCtx, "del") {
				fScore += 20
			}
			if strings.Contains(c.localCtx, "trasero") || strings.Contains(c.localCtx, "trasera") || strings.Contains(c.localCtx, "rear") || strings.Contains(c.localCtx, "tras") {
				fScore -= 20
			}
			frontTires = append(frontTires, candidate{value: c.value, score: fScore})

			rScore := 0
			if strings.Contains(c.localCtx, "trasero") || strings.Contains(c.localCtx, "trasera") || strings.Contains(c.localCtx, "rear") || strings.Contains(c.localCtx, "tras") {
				rScore += 20
			}
			if strings.Contains(c.localCtx, "delantero") || strings.Contains(c.localCtx, "delantera") || strings.Contains(c.localCtx, "front") || strings.Contains(c.localCtx, "del") {
				rScore -= 20
			}
			rearTires = append(rearTires, candidate{value: c.value, score: rScore})
		}

		sort.Slice(frontTires, func(i, j int) bool { return frontTires[i].score > frontTires[j].score })
		sort.Slice(rearTires, func(i, j int) bool { return rearTires[i].score > rearTires[j].score })

		// Fallback: if scores are equal, front is the first one found, rear is the second one found
		if frontTires[0].score == 0 && rearTires[0].score == 0 && len(tireCandidates) >= 2 {
			sort.Slice(tireCandidates, func(i, j int) bool { return tireCandidates[i].index < tireCandidates[j].index })
			specs.FrontTire = &tireCandidates[0].value
			specs.RearTire = &tireCandidates[1].value
		} else {
			specs.FrontTire = &frontTires[0].value
			// If rear tire is the same, try to find another candidate for the rear tire
			if rearTires[0].value == *specs.FrontTire && len(rearTires) > 1 {
				foundDifferent := false
				for _, r := range rearTires {
					if r.value != *specs.FrontTire {
						specs.RearTire = &r.value
						foundDifferent = true
						break
					}
				}
				if !foundDifferent {
					specs.RearTire = &rearTires[0].value
				}
			} else {
				specs.RearTire = &rearTires[0].value
			}
		}
	}

	return specs
}

func FetchVehicleSpecs(brand, model string, year int) (*VehicleSpecs, error) {
	filterFn := func(s string) bool {
		return isSnippetRelevantToModel(s, brand, model)
	}

	re := regexp.MustCompile(`([a-zA-Z]+)(\d+)`)
	searchModel := re.ReplaceAllString(model, "$1 $2")

	// 1. Try Spanish query first
	queryEs := fmt.Sprintf("%s %s %d ficha tecnica especificaciones", brand, searchModel, year)
	log.Printf("🔍 Scraping specs (Spanish) for: %s...", queryEs)
	
	snippets, err := fetchSnippetsFromDDG(queryEs)
	if err != nil {
		log.Printf("⚠️ DDG search failed, using empty snippets: %v", err)
		snippets = []string{}
	}
	
	var filteredSnippets []string
	for _, s := range snippets {
		if filterFn(s) {
			filteredSnippets = append(filteredSnippets, s)
		}
	}

	if len(filteredSnippets) == 0 {
		log.Printf("⚠️ DDG returned 0 results. Falling back to Yahoo Search (Spanish)...")
		yahooSnippets, err := fetchSnippetsFromYahoo(queryEs)
		if err == nil {
			for _, s := range yahooSnippets {
				if filterFn(s) {
					filteredSnippets = append(filteredSnippets, s)
				}
			}
		}
	}

	log.Printf("🤖 Found %d Spanish snippets to parse.", len(filteredSnippets))
	specs := extractSpecsWithScoring(filteredSnippets)

	// 2. English query fallback if specs are incomplete
	keyFieldsMissing := specs.EngineCc == nil || specs.Power == nil || specs.Torque == nil || specs.TankSize == nil || specs.Weight == nil
	if keyFieldsMissing {
		queryEn := fmt.Sprintf("%s %s %d specs specifications technical data", brand, searchModel, year)
		log.Printf("🔍 Specs incomplete (key fields missing). Scraping specs (English) for: %s...", queryEn)
		
		snippetsEn, err := fetchSnippetsFromDDG(queryEn)
		if err != nil {
			snippetsEn = []string{}
		}
		
		var filteredSnippetsEn []string
		for _, s := range snippetsEn {
			if filterFn(s) {
				filteredSnippetsEn = append(filteredSnippetsEn, s)
			}
		}

		if len(filteredSnippetsEn) == 0 {
			log.Printf("⚠️ DDG returned 0 results. Falling back to Yahoo Search (English)...")
			yahooSnippetsEn, err := fetchSnippetsFromYahoo(queryEn)
			if err == nil {
				for _, s := range yahooSnippetsEn {
					if filterFn(s) {
						filteredSnippetsEn = append(filteredSnippetsEn, s)
					}
				}
			}
		}

		log.Printf("🤖 Found %d English snippets to parse.", len(filteredSnippetsEn))
		if len(filteredSnippetsEn) > 0 {
			specsEn := extractSpecsWithScoring(filteredSnippetsEn)
			
			// Merge fields
			if specs.TankSize == nil && specsEn.TankSize != nil {
				specs.TankSize = specsEn.TankSize
			}
			if specs.FrontBrake == nil && specsEn.FrontBrake != nil {
				specs.FrontBrake = specsEn.FrontBrake
			}
			if specs.RearBrake == nil && specsEn.RearBrake != nil {
				specs.RearBrake = specsEn.RearBrake
			}
			if specs.FrontSuspension == nil && specsEn.FrontSuspension != nil {
				specs.FrontSuspension = specsEn.FrontSuspension
			}
			if specs.RearSuspension == nil && specsEn.RearSuspension != nil {
				specs.RearSuspension = specsEn.RearSuspension
			}
			if specs.FrontTire == nil && specsEn.FrontTire != nil {
				specs.FrontTire = specsEn.FrontTire
			}
			if specs.RearTire == nil && specsEn.RearTire != nil {
				specs.RearTire = specsEn.RearTire
			}
			if specs.EngineCc == nil && specsEn.EngineCc != nil {
				specs.EngineCc = specsEn.EngineCc
			}
			if specs.Power == nil && specsEn.Power != nil {
				specs.Power = specsEn.Power
			}
			if specs.Torque == nil && specsEn.Torque != nil {
				specs.Torque = specsEn.Torque
			}
			if specs.Transmission == nil && specsEn.Transmission != nil {
				specs.Transmission = specsEn.Transmission
			}
			if specs.Weight == nil && specsEn.Weight != nil {
				specs.Weight = specsEn.Weight
			}
			if specs.SeatHeight == nil && specsEn.SeatHeight != nil {
				specs.SeatHeight = specsEn.SeatHeight
			}
		}
	}

	return &specs, nil
}

// FetchVehicleSpecsDeep executes multiple targeted search queries across multiple languages
// and combines the snippets to maximize the chance of filling all motorcycle specifications.
func FetchVehicleSpecsDeep(brand, model string, year int) (*VehicleSpecs, error) {
	filterFn := func(s string) bool {
		return isSnippetRelevantToModel(s, brand, model)
	}

	re := regexp.MustCompile(`([a-zA-Z]+)(\d+)`)
	searchModel := re.ReplaceAllString(model, "$1 $2")

	queries := []string{
		fmt.Sprintf("%s %s %d ficha tecnica especificaciones", brand, searchModel, year),
		fmt.Sprintf("%s %s %d peso altura asiento deposito tanque torque potencia", brand, searchModel, year),
		fmt.Sprintf("%s %s %d llantas neumaticos suspension frenos transmision", brand, searchModel, year),
		fmt.Sprintf("%s %s %d specs specifications technical data", brand, searchModel, year),
		fmt.Sprintf("%s %s %d ficha tecnica especificações", brand, searchModel, year),
	}

	var allFilteredSnippets []string
	seenSnippets := make(map[string]bool)

	for _, query := range queries {
		log.Printf("🔍 Deep Scraper executing query: %s", query)
		snippets, err := fetchSnippetsFromDDG(query)
		if err != nil {
			log.Printf("⚠️ Deep Scraper: DDG search failed for query %q: %v", query, err)
			snippets = []string{}
		}

		var queryFiltered []string
		for _, s := range snippets {
			if filterFn(s) && !seenSnippets[s] {
				seenSnippets[s] = true
				queryFiltered = append(queryFiltered, s)
			}
		}

		// Fallback to Yahoo if DDG returned nothing relevant for this query
		if len(queryFiltered) == 0 {
			log.Printf("⚠️ Deep Scraper: DDG returned 0 results for %q. Falling back to Yahoo...", query)
			yahooSnippets, err := fetchSnippetsFromYahoo(query)
			if err == nil {
				for _, s := range yahooSnippets {
					if filterFn(s) && !seenSnippets[s] {
						seenSnippets[s] = true
						queryFiltered = append(queryFiltered, s)
					}
				}
			}
		}

		allFilteredSnippets = append(allFilteredSnippets, queryFiltered...)

		// Polite delay between requests to avoid rate limits
		time.Sleep(1200 * time.Millisecond)
	}

	log.Printf("🤖 Deep Scraper found total %d unique relevant snippets across all searches.", len(allFilteredSnippets))
	if len(allFilteredSnippets) == 0 {
		return &VehicleSpecs{}, nil
	}

	specs := extractSpecsWithScoring(allFilteredSnippets)
	return &specs, nil
}

func cleanDescription(keyword, remainder string) string {
	val := strings.TrimSpace(remainder)
	// Remove leading punctuation
	val = strings.TrimLeft(val, ":-=_ ")
	val = strings.TrimSpace(val)

	// Remove leading prepositions/verbs
	lower := strings.ToLower(val)
	if strings.HasPrefix(lower, "es ") {
		val = val[3:]
	} else if strings.HasPrefix(lower, "con ") {
		val = val[4:]
	} else if strings.HasPrefix(lower, "de ") {
		val = val[3:]
	} else if strings.HasPrefix(lower, "un ") {
		val = val[3:]
	} else if strings.HasPrefix(lower, "una ") {
		val = val[4:]
	}
	val = strings.TrimSpace(val)

	if val == "" {
		// Capitalize first letter of keyword
		full := keyword
		if len(full) > 0 {
			runes := []rune(full)
			runes[0] = []rune(strings.ToUpper(string(runes[0])))[0]
			full = string(runes)
		}
		return full
	}

	// Capitalize first letter of keyword + remainder
	full := keyword + " " + val

	// Capitalize first letter of full
	if len(full) > 0 {
		runes := []rune(full)
		runes[0] = []rune(strings.ToUpper(string(runes[0])))[0]
		full = string(runes)
	}

	return full
}


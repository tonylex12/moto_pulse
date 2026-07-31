package scraper

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type candidateTest struct {
	value string
	score int
}

func RunSuspensionTest() {
	brand := "Honda"
	model := "NX190"
	searchModel := "NX 190"
	year := 2026

	queries := []string{
		fmt.Sprintf("%s %s %d peso altura asiento deposito tanque torque potencia", brand, searchModel, year),
	}

	var tankCandidates []candidateTest

	tankRegex := regexp.MustCompile(`(?i)(\b\d+(?:[\.,]\d+)?)\s*(?:litros|litro|lts|l|gal|galones)\b`)

	for _, query := range queries {
		snippets, err := fetchSnippetsFromDDG(query)
		if err != nil {
			snippets = []string{}
		}
		if len(snippets) == 0 {
			snippets, err = fetchSnippetsFromYahoo(query)
			if err != nil {
				continue
			}
		}

		for _, s := range snippets {
			if isSnippetRelevantToModel(s, brand, model) {
				fmt.Printf("Relevant snippet for tank: %s\n", s)
				matches := tankRegex.FindAllStringSubmatchIndex(s, -1)
				for _, loc := range matches {
					if len(loc) < 4 {
						continue
					}
					valStr := strings.Replace(s[loc[2]:loc[3]], ",", ".", 1)
					val, err := strconv.ParseFloat(valStr, 64)
					if err != nil {
						continue
					}
					unit := strings.ToLower(s[loc[0]:loc[1]])
					if strings.Contains(unit, "gal") {
						val = val * 3.785
					}

					score := 0
					cleanSnippet := strings.ToLower(s)
					localCtx := getLocalContext(s, loc[0], loc[1], 50)

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

					displayVal := fmt.Sprintf("%.1f Litros", val)
					tankCandidates = append(tankCandidates, candidateTest{value: displayVal, score: score})
				}
			}
		}
	}

	fmt.Printf("\n=== TANK SIZE CANDIDATES ===\n")
	for _, c := range tankCandidates {
		fmt.Printf("  - %q (Score: %d)\n", c.value, c.score)
	}
}

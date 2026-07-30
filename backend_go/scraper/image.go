package scraper

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

func fetchTargetUrlsFromYahoo(queryText string) ([]string, error) {
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
		return nil, fmt.Errorf("yahoo image search returned status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	htmlContent := string(bodyBytes)

	var urls []string
	ruRegex := regexp.MustCompile(`RU=([^&'\"\/]+)`)
	matches := ruRegex.FindAllStringSubmatch(htmlContent, -1)
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		decoded, err := url.QueryUnescape(m[1])
		if err != nil {
			continue
		}
		if strings.HasPrefix(decoded, "http") && !strings.Contains(decoded, "yahoo.com") {
			alreadyExists := false
			for _, u := range urls {
				if u == decoded {
					alreadyExists = true
					break
				}
			}
			if !alreadyExists {
				urls = append(urls, decoded)
			}
		}
	}
	return urls, nil
}

func isUrlRelevantToModel(urlText, brand, model string) bool {
	_ = brand
	lowerURL := strings.ToLower(urlText)
	lowerModel := strings.ToLower(model)
	
	cleanModel := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return -1
	}, lowerModel)

	if strings.Contains(lowerURL, cleanModel) {
		return true
	}

	modelWords := splitNonAlphanumeric(lowerModel)
	if len(modelWords) > 0 {
		allMatch := true
		for _, w := range modelWords {
			if !strings.Contains(lowerURL, w) {
				allMatch = false
				break
			}
		}
		if allMatch {
			return true
		}
	}

	// Also split letters and numbers (e.g. "nx190" -> "nx", "190") to match URLs like "honda-nx-190"
	reLettersNumbers := regexp.MustCompile(`([a-zA-Z]+)|(\d+)`)
	matches := reLettersNumbers.FindAllString(lowerModel, -1)
	if len(matches) > 1 {
		allMatch := true
		for _, w := range matches {
			if !strings.Contains(lowerURL, w) {
				allMatch = false
				break
			}
		}
		if allMatch {
			return true
		}
	}

	codeRegex := regexp.MustCompile(`\b[a-z]+[-_/\s]?\d+[a-z]*\b`)
	codes := codeRegex.FindAllString(lowerURL, -1)
	foundConflict := false
	for _, code := range codes {
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
		return false
	}

	return true
}

func scrapeImageForQuery(queryText, brand, model string) (string, error) {
	query := url.QueryEscape(queryText)
	targetURL := fmt.Sprintf("https://html.duckduckgo.com/html/?q=%s", query)

	log.Printf("🔍 Scraping image search for: %s...", queryText)

	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var targetUrls []string

	if resp.StatusCode != http.StatusOK {
		log.Printf("⚠️ Duckduckgo returned status %d. Falling back to Yahoo search...", resp.StatusCode)
		yahooUrls, err := fetchTargetUrlsFromYahoo(queryText)
		if err == nil {
			for _, u := range yahooUrls {
				if isUrlRelevantToModel(u, brand, model) {
					targetUrls = append(targetUrls, u)
				}
			}
		}
	} else {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err == nil {
			htmlContent := string(bodyBytes)
			snippetRegex := regexp.MustCompile(`<a class="result__snippet"[^>]*href="([^"]+)"`)
			matches := snippetRegex.FindAllStringSubmatch(htmlContent, -1)
			for _, m := range matches {
				if len(m) < 2 {
					continue
				}
				targetUrl := m[1]
				if strings.Contains(targetUrl, "uddg=") {
					parts := strings.Split(targetUrl, "uddg=")
					if len(parts) >= 2 {
						decoded, err := url.QueryUnescape(strings.Split(parts[1], "&")[0])
						if err == nil {
							targetUrl = decoded
						}
					}
				}

				if strings.HasPrefix(targetUrl, "http") && !strings.Contains(targetUrl, "duckduckgo.com") {
					if isUrlRelevantToModel(targetUrl, brand, model) {
						targetUrls = append(targetUrls, targetUrl)
					} else {
						log.Printf("⚠️ Filtered out irrelevant URL candidate: %s", targetUrl)
					}
				}
			}
		}

		if len(targetUrls) == 0 {
			log.Printf("⚠️ DDG returned 0 links for image search. Falling back to Yahoo...")
			yahooUrls, err := fetchTargetUrlsFromYahoo(queryText)
			if err == nil {
				for _, u := range yahooUrls {
					if isUrlRelevantToModel(u, brand, model) {
						targetUrls = append(targetUrls, u)
					}
				}
			}
		}
	}

	// Prioritize high-quality domains
	highQualityDomains := []string{
		"wikipedia.org",
		"wikimedia.org",
		"cycleworld.com",
		"motorcycle.com",
		"motorcyclenews.com",
		"topspeed.com",
		"autoevolution.com",
		"ultimatemotorcycling.com",
	}

	// Stable sort by priority
	sortStableByQuality := func(a, b string) bool {
		aIsHigh := 0
		bIsHigh := 0
		for _, d := range highQualityDomains {
			if strings.Contains(strings.ToLower(a), d) {
				aIsHigh = 1
			}
			if strings.Contains(strings.ToLower(b), d) {
				bIsHigh = 1
			}
		}
		return aIsHigh > bIsHigh
	}

	// Sort matching targetUrls
	for i := 0; i < len(targetUrls); i++ {
		for j := i + 1; j < len(targetUrls); j++ {
			if sortStableByQuality(targetUrls[j], targetUrls[i]) {
				targetUrls[i], targetUrls[j] = targetUrls[j], targetUrls[i]
			}
		}
	}

	limit := 5
	if len(targetUrls) < limit {
		limit = len(targetUrls)
	}

	log.Printf("🤖 Found %d web pages. Scoping to top %d prioritized candidates.", len(targetUrls), limit)

	// Regex for meta tags
	ogRegex1 := regexp.MustCompile(`(?i)<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']`)
	ogRegex2 := regexp.MustCompile(`(?i)<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']`)
	twRegex1 := regexp.MustCompile(`(?i)<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']`)
	twRegex2 := regexp.MustCompile(`(?i)<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']`)
	blacklistRegex := regexp.MustCompile(`(?i)\b(logo|avatar|icon|profile|author|banner|header|default|placeholder|theme|css|sprite|button|ad|ads|advertisement|pixel|spacer|loader|spinner|og|share|social|facebook|twitter)\b|[-_]og\b`)

	for _, targetUrl := range targetUrls[:limit] {
		log.Printf("📸 Scraping OpenGraph image from page: %s...", targetUrl)
		
		pageReq, err := http.NewRequest("GET", targetUrl, nil)
		if err != nil {
			continue
		}
		pageReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		
		pageClient := &http.Client{Timeout: 4 * time.Second}
		pageResp, err := pageClient.Do(pageReq)
		if err != nil {
			continue
		}
		
		pageBytes, err := io.ReadAll(pageResp.Body)
		pageResp.Body.Close()
		if err != nil {
			continue
		}
		pageHtml := string(pageBytes)

		var imgMatch []string
		if m := ogRegex1.FindStringSubmatch(pageHtml); len(m) >= 2 {
			imgMatch = m
		} else if m := ogRegex2.FindStringSubmatch(pageHtml); len(m) >= 2 {
			imgMatch = m
		} else if m := twRegex1.FindStringSubmatch(pageHtml); len(m) >= 2 {
			imgMatch = m
		} else if m := twRegex2.FindStringSubmatch(pageHtml); len(m) >= 2 {
			imgMatch = m
		}

		if len(imgMatch) >= 2 {
			imageUrl := strings.TrimSpace(imgMatch[1])
			
			// Resolve relative URLs
			if strings.HasPrefix(imageUrl, "//") {
				imageUrl = "https:" + imageUrl
			} else if strings.HasPrefix(imageUrl, "/") {
				parsedBase, err := url.Parse(targetUrl)
				if err == nil {
					imageUrl = parsedBase.Scheme + "://" + parsedBase.Host + imageUrl
				}
			}

			// Clean up nested URLs
			if idx := strings.LastIndex(imageUrl, "http"); idx > 0 {
				imageUrl = imageUrl[idx:]
			}

			if strings.HasPrefix(imageUrl, "http") {
				if blacklistRegex.MatchString(imageUrl) {
					log.Printf("⚠️ Ignored layout/logo image candidate: %s", imageUrl)
					continue
				}
				log.Printf("✅ Extracted motorcycle image URL: %s", imageUrl)
				return imageUrl, nil
			}
		}
	}

	return "", fmt.Errorf("no image found on scanned pages")
}

func FetchVehicleImage(brand, model string, year int) (string, error) {
	// Insert space between letters and numbers for search query optimization (e.g. DL160 -> DL 160)
	re := regexp.MustCompile(`([a-zA-Z]+)(\d+)`)
	searchModel := re.ReplaceAllString(model, "$1 $2")

	// 1. Try local catalog query
	localQuery := fmt.Sprintf("%s %s site:somosmoto.pe OR site:motocorp.pe OR site:efe.com.pe", brand, searchModel)
	log.Printf("🔍 Scraping image search for local catalog: %s...", localQuery)
	if img, err := scrapeImageForQuery(localQuery, brand, model); err == nil && img != "" {
		return img, nil
	}

	// 2. Try general Spanish query
	queryEs := fmt.Sprintf("%s %s %d moto fotografia foto", brand, searchModel, year)
	log.Printf("🔍 Scraping image search for general Spanish: %s...", queryEs)
	if img, err := scrapeImageForQuery(queryEs, brand, model); err == nil && img != "" {
		return img, nil
	}

	// 3. Fallback to general English query
	queryEn := fmt.Sprintf("%s %s %d motorcycle photo review", brand, searchModel, year)
	log.Printf("🔍 Scraping image search for general English: %s...", queryEn)
	return scrapeImageForQuery(queryEn, brand, model)
}

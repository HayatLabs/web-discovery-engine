import { YahooSearchAdapter } from './search/duckduckgo-search.adapter.js';
import { ResultRanker } from './ranking/result-ranker.js';
import { PageFetcher } from './crawler/page-fetcher.js';
import { ContentExtractor } from './crawler/content-extractor.js';
import { LinkDiscoverer } from './crawler/link-discoverer.js';
import { ExtractedContent } from './models/index.js';

export class SearchOrchestrator {
    private searchAdapter = new YahooSearchAdapter();
    private ranker = new ResultRanker();
    private fetcher = new PageFetcher();
    private extractor = new ContentExtractor();
    private discoverer = new LinkDiscoverer();

    public async searchAndDiscover(query: string, maxResults: number = 5): Promise<ExtractedContent[]> {
        console.log(`[Orchestrator] Starting search and discovery pipeline for query: "${query}"`);


        // 1 => searching for the query using the search adaptr
        const rawSearchResults = await this.searchAdapter.search(query, maxResults * 2);

        console.log(`[Orchestrator] Raw search results fetched: ${rawSearchResults} results found.`);



        // 2 => ranking and filtering the search results to get unique domains

        const filteredResults = this.ranker.rankAndFilter(rawSearchResults, query).slice(0, maxResults);
        const urls = filteredResults.map(result => result.url);

        if (urls.length === 0) {
            return [];
        }




        // 3. parallel fetching of the homepage content for the filtered URLs
        const crawlResults = await this.fetcher.fetchAll(urls);




        // 4. parallel content extraction and link discovery for each fetched landing page 
        const processingPromises = crawlResults.map(async (crawlResult) => {


            // 4.1 content extraction from the fetched crawl result
            const extracted = await this.extractor.extract(crawlResult);



            // 4.2 link discovery: discover important routes from the homepage's HTML
            const routes = this.discoverer.discover(crawlResult.rawHtml, crawlResult.url);



            // 4.3 merging the discovered routes into the extracted content
            extracted.discoveredRoutes = routes;

            const hasEmailOrPhone = (extracted.contact?.emails && extracted.contact.emails.length > 0) ||
                (extracted.contact?.phones && extracted.contact.phones.length > 0);

            if (hasEmailOrPhone || extracted.metadata.isSocialMedia) {
                return extracted; // derectly reture if contact info is available 
            }


            
            const deepCrawlUrl = routes.contact[0] || routes.about[0];

            if (deepCrawlUrl) {


                console.log(`[Orchestrator] No contact info on homepage of ${crawlResult.url}. Deep crawling discovered link: ${deepCrawlUrl}`);
                const deepCrawlResult = await this.fetcher.fetchSingle(deepCrawlUrl);
                if (deepCrawlResult) {
                    const deepExtracted = await this.extractor.extract(deepCrawlResult);

                    return {
                        ...extracted,
                        about: deepExtracted.about || extracted.about,
                        contact: {
                            emails: [...new Set([...(extracted.contact?.emails || []), ...(deepExtracted.contact?.emails || [])])],
                            phones: [...new Set([...(extracted.contact?.phones || []), ...(deepExtracted.contact?.phones || [])])],
                            socials: [...new Set([...(extracted.contact?.socials || []), ...(deepExtracted.contact?.socials || [])])]
                        }
                    };
                }
            }

            return extracted;
        });

        const finalStructuredData = await Promise.all(processingPromises);
        console.log(`[Orchestrator] Successfully processed and structured ${finalStructuredData.length} sources.`);
        return finalStructuredData;
    }


  public async fetchAndDiscoverSingle(url: string): Promise<ExtractedContent | null> {
    console.log(`[Orchestrator] Direct fetching single URL: ${url}`);

    const crawlResult = await this.fetcher.fetchSingle(url);
    if (!crawlResult) {
      return null;
    }

    const extracted = await this.extractor.extract(crawlResult);

    const routes = this.discoverer.discover(crawlResult.rawHtml, crawlResult.url);
    extracted.discoveredRoutes = routes;

    const hasEmailOrPhone = (extracted.contact?.emails && extracted.contact.emails.length > 0) || 
                            (extracted.contact?.phones && extracted.contact.phones.length > 0);

    if (hasEmailOrPhone || extracted.metadata.isSocialMedia) {
      return extracted; 
    }

    const deepCrawlUrl = routes.contact[0] || routes.about[0];
    if (deepCrawlUrl) {
      console.log(`[Orchestrator] No contact info on homepage. Deep crawling discovered link: ${deepCrawlUrl}`);
      
      const deepCrawlResult = await this.fetcher.fetchSingle(deepCrawlUrl);
      if (deepCrawlResult) {
        const deepExtracted = await this.extractor.extract(deepCrawlResult);
        
        return {
          ...extracted,
          about: deepExtracted.about || extracted.about,
          contact: {
            emails: [...new Set([...(extracted.contact?.emails || []), ...(deepExtracted.contact?.emails || [])])],
            phones: [...new Set([...(extracted.contact?.phones || []), ...(deepExtracted.contact?.phones || [])])],
            socials: [...new Set([...(extracted.contact?.socials || []), ...(deepExtracted.contact?.socials || [])])]
          }
        };
      }
    }

    return extracted;
  }


}
import axios from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

import { ISearchAdapter } from './search-adapter.interface.js';
import { SearchResult } from '../models/index.js';

export class YahooSearchAdapter implements ISearchAdapter {

  private jar = new CookieJar();

  private client = wrapper(
    axios.create({
      jar: this.jar,
      withCredentials: true,
      maxRedirects: 10,
      timeout: 15000,

      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/140.0.0.0 Safari/537.36',

        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,' +
          'image/avif,image/webp,image/apng,*/*;q=0.8',

        'Accept-Language':
          'en-US,en;q=0.9',

        'Cache-Control': 'no-cache',

        'Pragma': 'no-cache',

        'Referer':
          'https://search.yahoo.com/'
      }
    })
  );

  async search(
    query: string,
    limit: number
  ): Promise<SearchResult[]> {

    console.log(
      `Live searching for: "${query}" using Yahoo Search...`
    );

    const searchUrl =
      `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;

    try {

      const response = await this.client.get(searchUrl);

      console.log(
        `[Yahoo] HTTP ${response.status} ${response.statusText}`
      );

      if (response.status !== 200) {
        console.error(
          `[Yahoo] Unexpected HTTP status: ${response.status}`
        );

        return [];
      }

      const html = response.data;

      if (!html || typeof html !== 'string') {
        console.error('[Yahoo] Empty HTML response.');
        return [];
      }

      console.log(
        `[Yahoo] Received ${html.length} bytes of HTML`
      );

      const $ = cheerio.load(html);

      console.log(
        `[Yahoo] Page title: "${$('title').text().trim()}"`
      );

      const results: SearchResult[] = [];

      /*
       * Yahoo organic results
       */
      $('div.dd.algo').each((_, element) => {

        if (results.length >= limit) {
          return;
        }

        const link = $(element)
          .find('h3 a')
          .first();

        const title = link
          .text()
          .trim();

        const href = link
          .attr('href') || '';

        if (!title || !href) {
          return;
        }

        const cleanUrl = this.extractRealUrl(href);

        if (!cleanUrl) {
          return;
        }

        try {

          const parsed = new URL(cleanUrl);

          const hostname =
            parsed.hostname.toLowerCase();

       
          if (
            hostname.includes('yahoo.com') ||
            hostname.includes('bing.com')
          ) {
            return;
          }

          const snippet =
            $(element)
              .find('.compText, .s-desc, p')
              .first()
              .text()
              .trim() ||
            'No description available.';

          if (
            results.some(
              result => result.url === parsed.href
            )
          ) {
            return;
          }

          results.push({
            title,
            url: parsed.href,
            snippet
          });

        } catch {
        }
      });

     
      if (results.length === 0) {

        console.log(
          '[Yahoo] Primary selector found 0 results.'
        );

        console.log(
          '[Yahoo] Trying fallback link parser...'
        );

        $('a').each((_, element) => {

          if (results.length >= limit) {
            return;
          }

          const title =
            $(element)
              .text()
              .trim();

          const href =
            $(element)
              .attr('href') || '';

          if (
            !title ||
            title.length < 3 ||
            !href
          ) {
            return;
          }

          const cleanUrl =
            this.extractRealUrl(href);

          if (!cleanUrl) {
            return;
          }

          try {

            const parsed =
              new URL(cleanUrl);

            const hostname =
              parsed.hostname.toLowerCase();

            if (
              hostname.includes('yahoo.com') ||
              hostname.includes('bing.com')
            ) {
              return;
            }

            if (!hostname.includes('.')) {
              return;
            }

            if (
              results.some(
                result => result.url === parsed.href
              )
            ) {
              return;
            }

            results.push({
              title,
              url: parsed.href,
              snippet: 'Yahoo search result'
            });

          } catch {
           
          }
        });
      }

      console.log(
        `[Yahoo] Processed ${results.length} organic web results.`
      );

      return results.slice(0, limit);

    } catch (error: any) {

      console.error(
        '[Yahoo] Search failed:',
        error?.message || error
      );

      if (error?.response) {

        console.error(
          `[Yahoo] HTTP ${error.response.status}`
        );

      }

      return [];
    }
  }

  private extractRealUrl(
    href: string
  ): string | null {

    try {

    
      if (href.includes('/RU=')) {

        const encoded =
          href
            .split('/RU=')[1]
            ?.split('/RK=')[0];

        if (encoded) {

          return decodeURIComponent(encoded);
        }
      }

 
      if (
        href.startsWith('http://') ||
        href.startsWith('https://')
      ) {
        return href;
      }

     
      if (href.startsWith('//')) {
        return `https:${href}`;
      }

      return null;

    } catch {

      return null;
    }
  }
}
import axios from 'axios';
import * as cheerio from 'cheerio';

import { ISearchAdapter } from './search-adapter.interface.js';
import { SearchResult } from '../models/index.js';

export class YahooSearchAdapter implements ISearchAdapter {

  private readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/140.0.0.0 Safari/537.36';

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

   

      const firstResponse = await axios.get(searchUrl, {
        maxRedirects: 0,
        timeout: 15000,

        validateStatus: (status) =>
          status >= 200 && status < 400,

        headers: {
          'User-Agent': this.userAgent,

          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,' +
            'image/avif,image/webp,image/apng,*/*;q=0.8',

          'Accept-Language':
            'en-US,en;q=0.9',

          'Cache-Control':
            'no-cache',

          'Pragma':
            'no-cache',

          'Referer':
            'https://search.yahoo.com/'
        }
      });

      console.log(
        `[Yahoo] First response: ${firstResponse.status} ${firstResponse.statusText}`
      );


      const setCookie =
        firstResponse.headers['set-cookie'];

      let ybvCookie: string | null = null;

      if (setCookie) {

        const cookieHeader = Array.isArray(setCookie)
          ? setCookie
          : [setCookie];

        const ybv = cookieHeader.find(
          cookie => cookie.startsWith('YBV=')
        );

        if (ybv) {

          ybvCookie =
            ybv.split(';')[0];

          console.log(
            '[Yahoo] YBV cookie received.'
          );
        }
      }

  

      let html: string | null = null;

      const location =
        firstResponse.headers.location;

      if (
        firstResponse.status >= 300 &&
        firstResponse.status < 400 &&
        location
      ) {

        console.log(
          `[Yahoo] Redirect received: ${location}`
        );

        const redirectUrl =
          new URL(
            location,
            'https://search.yahoo.com'
          ).toString();

        const secondResponse =
          await axios.get(redirectUrl, {

            maxRedirects: 10,

            timeout: 15000,

            headers: {
              'User-Agent': this.userAgent,

              'Accept':
                'text/html,application/xhtml+xml,application/xml;q=0.9,' +
                'image/avif,image/webp,image/apng,*/*;q=0.8',

              'Accept-Language':
                'en-US,en;q=0.9',

              'Referer':
                searchUrl,

              ...(ybvCookie
                ? {
                    'Cookie': ybvCookie
                  }
                : {})
            }
          });

        console.log(
          `[Yahoo] Redirect response: ${secondResponse.status} ${secondResponse.statusText}`
        );



        if (
          secondResponse.status === 200 &&
          typeof secondResponse.data === 'string'
        ) {

          const secondHtml =
            secondResponse.data;

          /*
           * Sometimes the redirect endpoint itself
           * returns the search page.
           */
          if (
            secondHtml.includes('search.yahoo.com') ||
            secondHtml.includes('<html') ||
            secondHtml.includes('<HTML')
          ) {

            html = secondHtml;
          }
        }
      }
      // 5. If redirect flow didn't return HTML,
      // request original search URL again with YBV

      if (!html) {

        console.log(
          '[Yahoo] Requesting search page with YBV cookie...'
        );

        const finalResponse =
          await axios.get(searchUrl, {

            maxRedirects: 10,

            timeout: 15000,

            headers: {
              'User-Agent': this.userAgent,

              'Accept':
                'text/html,application/xhtml+xml,application/xml;q=0.9,' +
                'image/avif,image/webp,image/apng,*/*;q=0.8',

              'Accept-Language':
                'en-US,en;q=0.9',

              'Referer':
                'https://search.yahoo.com/',

              ...(ybvCookie
                ? {
                    'Cookie': ybvCookie
                  }
                : {})
            }
          });

        console.log(
          `[Yahoo] Final response: ${finalResponse.status} ${finalResponse.statusText}`
        );

        if (
          finalResponse.status === 200 &&
          typeof finalResponse.data === 'string'
        ) {

          html = finalResponse.data;
        }
      }

      // 6. No HTML

      if (!html) {

        console.error(
          '[Yahoo] No search HTML received.'
        );

        return [];
      }

      console.log(
        `[Yahoo] Received ${html.length} bytes of HTML`
      );

      // 7. Parse HTML

      const $ = cheerio.load(html);

      console.log(
        `[Yahoo] Page title: "${$('title').text().trim()}"`
      );

      const results: SearchResult[] = [];

      // 8. Primary Yahoo result parser

      $('div.dd.algo').each((_, element) => {

        if (results.length >= limit) {
          return;
        }

        const link =
          $(element)
            .find('h3 a')
            .first();

        const title =
          link
            .text()
            .trim();

        const href =
          link.attr('href') || '';

        if (!title || !href) {
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

          // Ignore Yahoo/Bing internal links
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
              result =>
                result.url === parsed.href
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

      // 9. Fallback parser

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
                result =>
                  result.url === parsed.href
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
            // Ignore invalid URLs
          }
        });
      }

      // 10. Final result

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

      // Normal URL
      if (
        href.startsWith('http://') ||
        href.startsWith('https://')
      ) {
        return href;
      }

      // Protocol-relative URL
      if (href.startsWith('//')) {

        return `https:${href}`;
      }

      return null;

    } catch {

      return null;
    }
  }
}
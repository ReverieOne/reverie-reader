import {
    marshalErrorLike,
    RPCHost, RPCReflection,
    HashManager,
    AssertionFailureError, ParamValidationError, Defer,
} from 'civkit';
import { singleton } from 'tsyringe';
import { AsyncContext, CloudHTTPv2, FirebaseStorageBucketControl, Logger, OutputServerEventStream, RPCReflect } from '../shared/index';
import _ from 'lodash';
import { PageSnapshot, PuppeteerControl, ScrappingOptions } from '../services/puppeteer';
import { Request, Response } from 'express';
const pNormalizeUrl = import("@esm2cjs/normalize-url");
// import { AltTextService } from '../services/alt-text';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
// import { Crawled } from '../db/crawled';
import { cleanAttribute } from '../utils/misc';
import { randomUUID } from 'crypto';
import { tidyMarkdown } from '../utils/markdown';

import { CrawlerOptions, CrawlerOptionsHeaderOnly } from '../dto/scrapping-options';
// import { PDFExtractor } from '../services/pdf-extract';
import { DomainBlockade } from '../db/domain-blockade';
import { JSDomControl } from '../services/jsdom';
import { TimingService } from '../services/timing';

console.log('Initializing CrawlerHost');

const md5Hasher = new HashManager('md5', 'hex');

// const logger = new Logger('Crawler');

import { TransferProtocolMetadata } from 'civkit';

function sendResponse<T>(res: Response, data: T, meta: TransferProtocolMetadata): T {
    if (meta.code) {
        res.status(meta.code);
    }
    if (meta.contentType) {
        res.type(meta.contentType);
    }
    if (meta.headers) {
        for (const [key, value] of Object.entries(meta.headers)) {
            if (value !== undefined) {
                res.setHeader(key, value);
            }
        }
    }
    res.send(data);
    return data;
}


export interface ExtraScrappingOptions extends ScrappingOptions {
    withIframe?: boolean;
    targetSelector?: string | string[];
    removeSelector?: string | string[];
    keepImgDataUrl?: boolean;
}

export interface FormattedPage {
    title?: string;
    description?: string;
    url?: string;
    content?: string;
    publishedTime?: string;
    html?: string;
    text?: string;
    screenshotUrl?: string;
    screenshot?: Buffer;
    pageshotUrl?: string;
    pageshot?: Buffer;
    links?: { [k: string]: string; };
    images?: { [k: string]: string; };

    toString: () => string;
}

const indexProto = {
    toString: function (): string {
        console.log('Converting index to string');
        return _(this)
            .toPairs()
            .map(([k, v]) => k ? `[${_.upperFirst(_.lowerCase(k))}] ${v}` : '')
            .value()
            .join('\n') + '\n';
    }
};

@singleton()
export class CrawlerHost extends RPCHost {
    logger = new Logger('Crawler');

    turnDownPlugins = [
        require('turndown-plugin-gfm').tables
    ];

    cacheRetentionMs = 1000 * 3600 * 24 * 7;
    cacheValidMs = 1000 * 3600;
    urlValidMs = 1000 * 3600 * 4;
    abuseBlockMs = 1000 * 3600;

    constructor(
        private timingService: TimingService,
        protected puppeteerControl: PuppeteerControl,
        protected jsdomControl: JSDomControl,
        // protected altTextService: AltTextService,
        // protected pdfExtractor: PDFExtractor,
        protected firebaseObjectStorage: FirebaseStorageBucketControl,
        protected threadLocal: AsyncContext,
    ) {
        super(...arguments);
        console.log('CrawlerHost constructor called');
        console.log('Initializing CrawlerHost with dependencies:', {
            puppeteerControl: !!puppeteerControl,
            jsdomControl: !!jsdomControl,
            firebaseObjectStorage: !!firebaseObjectStorage,
            threadLocal: !!threadLocal
        });

        puppeteerControl.on('crawled', async (snapshot: PageSnapshot, options: ScrappingOptions & { url: URL; }) => {
            console.log('Crawled event received', { url: options.url.toString() });
            if (!snapshot.title?.trim() && !snapshot.pdfs?.length) {
                console.log('Skipping snapshot due to empty title and no PDFs');
                return;
            }
            if (options.cookies?.length) {
                console.log('Skipping caching due to cookies');
                // Potential privacy issue, dont cache if cookies are used
                return;
            }
        });

        puppeteerControl.on('abuse', async (abuseEvent: { url: URL; reason: string, sn: number; }) => {
            console.log('Abuse event received', abuseEvent);
            this.logger.warn(`Abuse detected on ${abuseEvent.url}, blocking ${abuseEvent.url.hostname}`, { reason: abuseEvent.reason, sn: abuseEvent.sn });

            await DomainBlockade.save(DomainBlockade.from({
                domain: abuseEvent.url.hostname.toLowerCase(),
                triggerReason: `${abuseEvent.reason}`,
                triggerUrl: abuseEvent.url.toString(),
                createdAt: new Date(),
                expireAt: new Date(Date.now() + this.abuseBlockMs),
            })).catch((err) => {
                console.error('Failed to save domain blockade', err);
                this.logger.warn(`Failed to save domain blockade for ${abuseEvent.url.hostname}`, { err: marshalErrorLike(err) });
            });

        });
    }

    override async init() {
        console.log('Initializing CrawlerHost');
        await this.dependencyReady();

        this.emit('ready');
        console.log('CrawlerHost ready');
        console.log('CrawlerHost initialization complete');
    }

    getIndex() {
        console.log('Getting index');
        const indexObject: Record<string, string | number | undefined> = Object.create(indexProto);

        Object.assign(indexObject, {
            usage1: 'https://r.jina.ai/YOUR_URL',
            usage2: 'https://s.jina.ai/YOUR_SEARCH_QUERY',
            homepage: 'https://jina.ai/reader',
            sourceCode: 'https://github.com/jina-ai/reader',
        });

        console.log('Index object created:', indexObject);
        return indexObject;
    }

    getTurndown(options?: {
        noRules?: boolean | string,
        url?: string | URL;
        imgDataUrlToObjectUrl?: boolean;
    }) {
        console.log('Getting Turndown service', options);
        const turnDownService = new TurndownService({
            codeBlockStyle: 'fenced',
            preformattedCode: true,
            headingStyle: 'atx'
        } as any);
        if (!options?.noRules) {
            console.log('Adding Turndown rules');
            turnDownService.addRule('headings', {
                filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
                replacement: function (content, node: any) {
                    const level = Number(node.nodeName.charAt(1));
                    const hashes = '#'.repeat(level);
                    return `\n\n${hashes} ${content}\n\n`;
                }
            });
            turnDownService.addRule('remove-irrelevant', {
                filter: ['meta', 'style', 'script', 'noscript', 'link', 'textarea', 'select'],
                replacement: () => ''
            });
            turnDownService.addRule('truncate-svg', {
                filter: 'svg' as any,
                replacement: () => ''
            });
            turnDownService.addRule('title-as-h1', {
                filter: ['title'],
                replacement: (innerText) => `${innerText}\n===============\n`
            });
        }

        if (options?.imgDataUrlToObjectUrl) {
            console.log('Adding data-url-to-pseudo-object-url rule');
            turnDownService.addRule('data-url-to-pseudo-object-url', {
                filter: (node) => Boolean(node.tagName === 'IMG' && node.getAttribute('src')?.startsWith('data:')),
                replacement: (_content, node: any) => {
                    const src = (node.getAttribute('src') || '').trim();
                    const alt = cleanAttribute(node.getAttribute('alt')) || '';

                    if (options.url) {
                        const refUrl = new URL(options.url);
                        const mappedUrl = new URL(`blob:${refUrl.origin}/${md5Hasher.hash(src)}`);

                        return `![${alt}](${mappedUrl})`;
                    }

                    return `![${alt}](blob:${md5Hasher.hash(src)})`;
                }
            });
        }

        turnDownService.addRule('improved-paragraph', {
            filter: 'p',
            replacement: (innerText) => {
                const trimmed = innerText.trim();
                if (!trimmed) {
                    return '';
                }

                return `${trimmed.replace(/\n{3,}/g, '\n\n')}\n\n`;
            }
        });
        turnDownService.addRule('improved-inline-link', {
            filter: function (node, options) {
                return Boolean(
                    options.linkStyle === 'inlined' &&
                    node.nodeName === 'A' &&
                    node.getAttribute('href')
                );
            },

            replacement: function (content, node: any) {
                let href = node.getAttribute('href');
                if (href) href = href.replace(/([()])/g, '\\$1');
                let title = cleanAttribute(node.getAttribute('title'));
                if (title) title = ' "' + title.replace(/"/g, '\\"') + '"';

                const fixedContent = content.replace(/\s+/g, ' ').trim();
                let fixedHref = href.replace(/\s+/g, '').trim();
                if (options?.url) {
                    try {
                        fixedHref = new URL(fixedHref, options.url).toString();
                    } catch (_err) {
                        void 0;
                    }
                }

                return `[${fixedContent}](${fixedHref}${title || ''})`;
            }
        });
        turnDownService.addRule('improved-code', {
            filter: function (node: any) {
                let hasSiblings = node.previousSibling || node.nextSibling;
                let isCodeBlock = node.parentNode.nodeName === 'PRE' && !hasSiblings;

                return node.nodeName === 'CODE' && !isCodeBlock;
            },

            replacement: function (inputContent: any) {
                if (!inputContent) return '';
                let content = inputContent;

                let delimiter = '`';
                let matches = content.match(/`+/gm) || [];
                while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + '`';
                if (content.includes('\n')) {
                    delimiter = '```';
                }

                let extraSpace = delimiter === '```' ? '\n' : /^`|^ .*?[^ ].* $|`$/.test(content) ? ' ' : '';

                return delimiter + extraSpace + content + (delimiter === '```' && !content.endsWith(extraSpace) ? extraSpace : '') + delimiter;
            }
        });

        console.log('Turndown service configured');
        return turnDownService;
    }

    getGeneralSnapshotMixins(snapshot: PageSnapshot) {
        console.log('Getting general snapshot mixins');
        let inferred;
        const mixin: any = {};
        if (this.threadLocal.get('withImagesSummary')) {
            console.log('Generating image summary');
            inferred ??= this.jsdomControl.inferSnapshot(snapshot);
            const imageSummary = {} as { [k: string]: string; };
            const imageIdxTrack = new Map<string, number[]>();

            let imgIdx = 0;

            for (const img of inferred.imgs) {
                const imgSerial = ++imgIdx;
                const idxArr = imageIdxTrack.has(img.src) ? imageIdxTrack.get(img.src)! : [];
                idxArr.push(imgSerial);
                imageIdxTrack.set(img.src, idxArr);
                imageSummary[img.src] = img.alt || '';
            }

            mixin.images =
                _(imageSummary)
                    .toPairs()
                    .map(
                        ([url, alt], i) => {
                            return [`Image ${(imageIdxTrack?.get(url) || [i + 1]).join(',')}${alt ? `: ${alt}` : ''}`, url];
                        }
                    ).fromPairs()
                    .value();
            console.log(`Generated image summary with ${Object.keys(mixin.images).length} images`);
        }
        if (this.threadLocal.get('withLinksSummary')) {
            console.log('Generating link summary');
            inferred ??= this.jsdomControl.inferSnapshot(snapshot);
            mixin.links = _.invert(inferred.links || {});
            console.log(`Generated link summary with ${Object.keys(mixin.links).length} links`);
        }

        return mixin;
    }

    async formatSnapshot(mode: string | 'markdown' | 'html' | 'text' | 'screenshot' | 'pageshot', snapshot: PageSnapshot & {
        screenshotUrl?: string;
        pageshotUrl?: string;
    }, nominalUrl?: URL) {
        this.timingService.startTiming('formatSnapshot');
        try {
            console.log('Formatting snapshot', {
                mode,
                url: nominalUrl?.toString(),
                removeImages: this.threadLocal.get('removeImagesFromMarkdown'),
                removeLinks: this.threadLocal.get('removeLinksFromMarkdown')
            });
            if (mode === 'screenshot') {
                if (snapshot.screenshot && !snapshot.screenshotUrl) {
                    console.log('Saving screenshot');
                    const fid = `instant-screenshots/${randomUUID()}`;
                    await this.firebaseObjectStorage.saveFile(fid, snapshot.screenshot, {
                        metadata: {
                            contentType: 'image/png',
                        }
                    });
                    snapshot.screenshotUrl = await this.firebaseObjectStorage.signDownloadUrl(fid, Date.now() + this.urlValidMs);
                    console.log('Screenshot saved and URL generated', { screenshotUrl: snapshot.screenshotUrl });
                }

                return {
                    ...this.getGeneralSnapshotMixins(snapshot),
                    // html: snapshot.html,
                    screenshotUrl: snapshot.screenshotUrl,
                    toString() {
                        return this.screenshotUrl;
                    }
                } as FormattedPage;
            }
            if (mode === 'pageshot') {
                this.timingService.startTiming('processPageshot');
                try {
                    if (snapshot.pageshot && !snapshot.pageshotUrl) {
                        console.log('Saving pageshot');
                        const fid = `instant-screenshots/${randomUUID()}`;
                        await this.firebaseObjectStorage.saveFile(fid, snapshot.pageshot, {
                            metadata: {
                                contentType: 'image/png',
                            }
                        });
                        snapshot.pageshotUrl = await this.firebaseObjectStorage.signDownloadUrl(fid, Date.now() + this.urlValidMs);
                        console.log('Pageshot saved and URL generated', { pageshotUrl: snapshot.pageshotUrl });
                    }

                    return {
                        ...this.getGeneralSnapshotMixins(snapshot),
                        html: snapshot.html,
                        pageshotUrl: snapshot.pageshotUrl,
                        toString() {
                            return this.pageshotUrl;
                        }
                    } as FormattedPage;
                } finally {
                    this.timingService.endTiming('processPageshot');
                }
            }
            if (mode === 'html') {
                console.log('Formatting as HTML');
                return {
                    ...this.getGeneralSnapshotMixins(snapshot),
                    html: snapshot.html,
                    toString() {
                        return this.html;
                    }
                } as FormattedPage;
            }

            let pdfMode = false;

            if (mode === 'text') {
                console.log('Formatting as text');
                return {
                    ...this.getGeneralSnapshotMixins(snapshot),
                    text: snapshot.text,
                    toString() {
                        return this.text;
                    }
                } as FormattedPage;
            }
            const imgDataUrlToObjectUrl = !Boolean(this.threadLocal.get('keepImgDataUrl'));

            let contentText = '';
            const imageSummary = {} as { [k: string]: string; };
            const imageIdxTrack = new Map<string, number[]>();
            do {
                if (pdfMode) {
                    console.log('PDF mode detected');
                    contentText = snapshot.parsed?.content || snapshot.text;
                    break;
                }

                if (
                    snapshot.maxElemDepth! > 256 ||
                    snapshot.elemCount! > 70_000
                ) {
                    console.log('Degrading to text to protect the server');
                    this.logger.warn('Degrading to text to protect the server', { url: snapshot.href });
                    contentText = snapshot.text;
                    break;
                }

                console.log('Processing HTML content');
                const jsDomElementOfHTML = this.jsdomControl.snippetToElement(snapshot.html, snapshot.href);
                let toBeTurnedToMd = jsDomElementOfHTML;
                let turnDownService = this.getTurndown({ url: snapshot.rebase || nominalUrl, imgDataUrlToObjectUrl });
                if (mode !== 'markdown' && snapshot.parsed?.content) {
                    console.log('Processing parsed content for non-markdown mode');
                    const jsDomElementOfParsed = this.jsdomControl.snippetToElement(snapshot.parsed.content, snapshot.href);
                    console.log('Created jsDomElementOfParsed');
                    const par1 = this.jsdomControl.runTurndown(turnDownService, jsDomElementOfHTML);
                    console.log('Generated par1 from jsDomElementOfHTML');
                    const par2 = snapshot.parsed.content ? this.jsdomControl.runTurndown(turnDownService, jsDomElementOfParsed) : '';
                    console.log('Generated par2 from jsDomElementOfParsed');

                    // If Readability did its job
                    if (par2.length >= 0.3 * par1.length) {
                        console.log('Readability seems to have done its job, adjusting turnDownService');
                        turnDownService = this.getTurndown({ noRules: true, url: snapshot.rebase || nominalUrl, imgDataUrlToObjectUrl });
                        if (snapshot.parsed.content) {
                            console.log('Using parsed content for toBeTurnedToMd');
                            toBeTurnedToMd = jsDomElementOfParsed;
                        }
                    } else {
                        console.log('Readability output not sufficient, using original HTML');
                    }
                } else {
                    console.log('Skipping parsed content processing');
                }

                for (const plugin of this.turnDownPlugins) {
                    turnDownService = turnDownService.use(plugin);
                }
                const urlToAltMap: { [k: string]: string | undefined; } = {};
                if (snapshot.imgs?.length && this.threadLocal.get('withGeneratedAlt')) {
                    const tasks = _.uniqBy((snapshot.imgs || []), 'src').map(async (x) => {
                        const r = "ALT TEXT!!!"
                        if (r && x.src) {
                            urlToAltMap[x.src.trim()] = r;
                        }
                    });

                    await Promise.all(tasks);
                }
                let imgIdx = 0;
                turnDownService.addRule('img-generated-alt', {
                    filter: 'img',
                    replacement: (_content, node: any) => {
                        let linkPreferredSrc = (node.getAttribute('src') || '').trim();
                        if (!linkPreferredSrc || linkPreferredSrc.startsWith('data:')) {
                            const dataSrc = (node.getAttribute('data-src') || '').trim();
                            if (dataSrc && !dataSrc.startsWith('data:')) {
                                linkPreferredSrc = dataSrc;
                            }
                        }

                        let src;
                        try {
                            src = new URL(linkPreferredSrc, snapshot.rebase || nominalUrl).toString();
                        } catch (_err) {
                            void 0;
                        }
                        const alt = cleanAttribute(node.getAttribute('alt'));
                        if (!src) {
                            return '';
                        }
                        const mapped = urlToAltMap[src];
                        const imgSerial = ++imgIdx;
                        const idxArr = imageIdxTrack.has(src) ? imageIdxTrack.get(src)! : [];
                        idxArr.push(imgSerial);
                        imageIdxTrack.set(src, idxArr);

                        if (mapped) {
                            imageSummary[src] = mapped || alt;

                            if (src?.startsWith('data:') && imgDataUrlToObjectUrl) {
                                const mappedUrl = new URL(`blob:${nominalUrl?.origin || ''}/${md5Hasher.hash(src)}`);
                                mappedUrl.protocol = 'blob:';

                                return `![Image ${imgIdx}: ${mapped || alt}](${mappedUrl})`;
                            }

                            return `![Image ${imgIdx}: ${mapped || alt}](${src})`;
                        }

                        imageSummary[src] = alt || '';

                        if (src?.startsWith('data:') && imgDataUrlToObjectUrl) {
                            const mappedUrl = new URL(`blob:${nominalUrl?.origin || ''}/${md5Hasher.hash(src)}`);
                            mappedUrl.protocol = 'blob:';

                            return alt ? `![Image ${imgIdx}: ${alt}](${mappedUrl})` : `![Image ${imgIdx}](${mappedUrl})`;
                        }

                        return alt ? `![Image ${imgIdx}: ${alt}](${src})` : `![Image ${imgIdx}](${src})`;
                    }
                });

                if (toBeTurnedToMd) {
                    try {
                        contentText = this.jsdomControl.runTurndown(turnDownService, toBeTurnedToMd).trim();
                    } catch (err) {
                        this.logger.warn(`Turndown failed to run, retrying without plugins`, { err });
                        const vanillaTurnDownService = this.getTurndown({ url: snapshot.rebase || nominalUrl, imgDataUrlToObjectUrl });
                        try {
                            contentText = this.jsdomControl.runTurndown(vanillaTurnDownService, toBeTurnedToMd).trim();
                        } catch (err2) {
                            this.logger.warn(`Turndown failed to run, giving up`, { err: err2 });
                        }
                    }
                }

                if (
                    !contentText || (contentText.startsWith('<') && contentText.endsWith('>'))
                    && toBeTurnedToMd !== jsDomElementOfHTML
                ) {
                    try {
                        contentText = this.jsdomControl.runTurndown(turnDownService, snapshot.html);
                    } catch (err) {
                        this.logger.warn(`Turndown failed to run, retrying without plugins`, { err });
                        const vanillaTurnDownService = this.getTurndown({ url: snapshot.rebase || nominalUrl, imgDataUrlToObjectUrl });
                        try {
                            contentText = this.jsdomControl.runTurndown(vanillaTurnDownService, snapshot.html);
                        } catch (err2) {
                            this.logger.warn(`Turndown failed to run, giving up`, { err: err2 });
                        }
                    }
                }
                if (!contentText || (contentText.startsWith('<') || contentText.endsWith('>'))) {
                    contentText = snapshot.text;
                }
            } while (false);

            const cleanText = (contentText || '').trim();

            // Add tidyMarkdown with options here
            const finalContent = tidyMarkdown(cleanText, {
                removeImages: Boolean(this.threadLocal.get('removeImagesFromMarkdown')),
                removeLinks: Boolean(this.threadLocal.get('removeLinksFromMarkdown'))
            });

            const formatted: FormattedPage = {
                title: (snapshot.parsed?.title || snapshot.title || '').trim(),
                url: nominalUrl?.toString() || snapshot.href?.trim(),
                content: finalContent,  // Use the processed content
                publishedTime: snapshot.parsed?.publishedTime || undefined,

                toString() {
                    if (mode === 'markdown') {
                        return this.content as string;
                    }

                    const mixins: string[] = [];
                    if (this.publishedTime) {
                        mixins.push(`Published Time: ${this.publishedTime}`);
                    }
                    const suffixMixins: string[] = [];
                    if (this.images) {
                        const imageSummaryChunks: string[] = ['Images:'];
                        for (const [k, v] of Object.entries(this.images)) {
                            imageSummaryChunks.push(`- ![${k}](${v})`);
                        }
                        if (imageSummaryChunks.length === 1) {
                            imageSummaryChunks.push('This page does not seem to contain any images.');
                        }
                        suffixMixins.push(imageSummaryChunks.join('\n'));
                    }
                    if (this.links) {
                        const linkSummaryChunks = ['Links/Buttons:'];
                        for (const [k, v] of Object.entries(this.links)) {
                            linkSummaryChunks.push(`- [${k}](${v})`);
                        }
                        if (linkSummaryChunks.length === 1) {
                            linkSummaryChunks.push('This page does not seem to contain any buttons/links.');
                        }
                        suffixMixins.push(linkSummaryChunks.join('\n'));
                    }

                    return `Title: ${this.title}

URL Source: ${this.url}
${mixins.length ? `\n${mixins.join('\n\n')}\n` : ''}
Markdown Content:
${this.content}
${suffixMixins.length ? `\n${suffixMixins.join('\n\n')}\n` : ''}`;
                }
            };

            if (this.threadLocal.get('withImagesSummary')) {
                formatted.images =
                    _(imageSummary)
                        .toPairs()
                        .map(
                            ([url, alt], i) => {
                                return [`Image ${(imageIdxTrack?.get(url) || [i + 1]).join(',')}${alt ? `: ${alt}` : ''}`, url];
                            }
                        ).fromPairs()
                        .value();
            }
            if (this.threadLocal.get('withLinksSummary')) {
                formatted.links = _.invert(this.jsdomControl.inferSnapshot(snapshot).links || {});
            }

            return formatted as FormattedPage;
        } finally {
            this.timingService.endTiming('formatSnapshot');
        }
    }

    async crawl(req: Request, res: Response) {
        this.timingService.startTiming('totalCrawl');
        try {
            console.log('Crawl method called with request:', req.url);
            // res.setHeader('Access-Control-Allow-Origin', '*');
            // res.send('Helloooooooo!');
            // const rpcReflect: RPCReflection = {};
            const ctx = { req, res };
            console.log(`req.headers: ${JSON.stringify(req.headers)}`);
            const crawlerOptionsHeaderOnly = CrawlerOptionsHeaderOnly.from(req);
            const crawlerOptionsParamsAllowed = CrawlerOptions.from(req.method === 'POST' ? req.body : req.query, req);
            const noSlashURL = ctx.req.url.slice(1);
            const crawlerOptions = ctx.req.method === 'GET' ? crawlerOptionsHeaderOnly : crawlerOptionsParamsAllowed;
            console.log('Crawler options:', crawlerOptions);

            // Set the options in thread local
            this.threadLocal.set('removeImagesFromMarkdown', crawlerOptions.removeImagesFromMarkdown);
            this.threadLocal.set('removeLinksFromMarkdown', crawlerOptions.removeLinksFromMarkdown);

            if (!noSlashURL && !crawlerOptions.url) {
                console.log('No URL provided, returning index');
                if (!ctx.req.accepts('text/plain') && (ctx.req.accepts('text/json') || ctx.req.accepts('application/json'))) {
                    return this.getIndex();
                }

                return sendResponse(res, `${this.getIndex()}`,
                    { contentType: 'text/plain', envelope: null }
                );
            }

            // Prevent circular crawling
            this.puppeteerControl.circuitBreakerHosts.add(
                ctx.req.hostname.toLowerCase()
            );
            console.log('Added to circuit breaker hosts:', ctx.req.hostname.toLowerCase());

            let urlToCrawl;
            const normalizeUrl = (await pNormalizeUrl).default;
            try {
                urlToCrawl = new URL(
                    normalizeUrl(
                        (crawlerOptions.url || noSlashURL).trim(),
                        {
                            stripWWW: false,
                            removeTrailingSlash: false,
                            removeSingleSlash: false,
                            sortQueryParameters: false,
                        }
                    )
                );
                console.log('Normalized URL to crawl:', urlToCrawl.toString());
            } catch (err) {
                console.error('Error normalizing URL:', err);
                throw new ParamValidationError({
                    message: `${err}`,
                    path: 'url'
                });
            }
            if (urlToCrawl.protocol !== 'http:' && urlToCrawl.protocol !== 'https:') {
                console.error('Invalid protocol:', urlToCrawl.protocol);
                throw new ParamValidationError({
                    message: `Invalid protocol ${urlToCrawl.protocol}`,
                    path: 'url'
                });
            }

            const crawlOpts = this.configure(crawlerOptions, req, urlToCrawl);
            console.log('Configured crawl options:', crawlOpts);

            if (!ctx.req.accepts('text/plain') && ctx.req.accepts('text/event-stream')) {
                const sseStream = new OutputServerEventStream();
                // rpcReflect.return(sseStream);

                try {
                    for await (const scrapped of this.scrap(urlToCrawl, crawlOpts, crawlerOptions)) {
                        if (!scrapped) {
                            continue;
                        }

                        const formatted = await this.formatSnapshot(crawlerOptions.respondWith, scrapped, urlToCrawl);
                        sseStream.write({
                            event: 'data',
                            data: formatted,
                        });
                    }
                } catch (err: any) {
                    this.logger.error(`Failed to crawl ${urlToCrawl}`, { err: marshalErrorLike(err) });
                    sseStream.write({
                        event: 'error',
                        data: marshalErrorLike(err),
                    });
                }

                sseStream.end();

                return sseStream;
            }

            let lastScrapped;
            if (!ctx.req.accepts('text/plain') && (ctx.req.accepts('text/json') || ctx.req.accepts('application/json'))) {
                for await (const scrapped of this.scrap(urlToCrawl, crawlOpts, crawlerOptions)) {
                    lastScrapped = scrapped;
                    if (crawlerOptions.waitForSelector || ((!scrapped?.parsed?.content || !scrapped.title?.trim()) && !scrapped?.pdfs?.length)) {
                        continue;
                    }

                    const formatted = await this.formatSnapshot(crawlerOptions.respondWith, scrapped, urlToCrawl);

                    if (crawlerOptions.timeout === undefined) {
                        return formatted;
                    }
                }

                if (!lastScrapped) {
                    throw new AssertionFailureError(`No content available for URL ${urlToCrawl}`);
                }

                const formatted = await this.formatSnapshot(crawlerOptions.respondWith, lastScrapped, urlToCrawl);

                return formatted;
            }

            for await (const scrapped of this.scrap(urlToCrawl, crawlOpts, crawlerOptions)) {
                lastScrapped = scrapped;
                if (crawlerOptions.waitForSelector || ((!scrapped?.parsed?.content || !scrapped.title?.trim()) && !scrapped?.pdfs?.length)) {
                    continue;
                }

                const formatted = await this.formatSnapshot(crawlerOptions.respondWith, scrapped, urlToCrawl);

                if (crawlerOptions.timeout === undefined) {
                    if (crawlerOptions.respondWith === 'screenshot' && Reflect.get(formatted, 'screenshotUrl')) {
                        return sendResponse(res, `${formatted}`,
                            { code: 302, envelope: null, headers: { Location: Reflect.get(formatted, 'screenshotUrl') } }
                        );
                    }
                    if (crawlerOptions.respondWith === 'pageshot' && Reflect.get(formatted, 'pageshotUrl')) {
                        return sendResponse(res, `${formatted}`,
                            { code: 302, envelope: null, headers: { Location: Reflect.get(formatted, 'pageshotUrl') } }
                        );
                    }

                    return sendResponse(res, `${formatted}`, { contentType: 'text/plain', envelope: null });
                }
            }

            if (!lastScrapped) {
                throw new AssertionFailureError(`No content available for URL ${urlToCrawl}`);
            }

            const formatted = await this.formatSnapshot(crawlerOptions.respondWith, lastScrapped, urlToCrawl);
            if (crawlerOptions.respondWith === 'screenshot' && Reflect.get(formatted, 'screenshotUrl')) {
                return sendResponse(res, `${formatted}`,
                    { code: 302, envelope: null, headers: { Location: Reflect.get(formatted, 'screenshotUrl') } }
                );
            }
            if (crawlerOptions.respondWith === 'pageshot' && Reflect.get(formatted, 'pageshotUrl')) {
                return sendResponse(res, `${formatted}`,
                    { code: 302, envelope: null, headers: { Location: Reflect.get(formatted, 'pageshotUrl') } }
                );
            }

            return sendResponse(res, `${formatted}`, { contentType: 'text/plain', envelope: null });
        } finally {
            this.timingService.endTiming('totalCrawl');
            this.timingService.logTimings();
        }
    }

    getUrlDigest(urlToCrawl: URL) {
        const normalizedURL = new URL(urlToCrawl);
        if (!normalizedURL.hash.startsWith('#/')) {
            normalizedURL.hash = '';
        }
        const normalizedUrl = normalizedURL.toString().toLowerCase();
        const digest = md5Hasher.hash(normalizedUrl.toString());

        return digest;
    }

    async *scrap(urlToCrawl: URL, crawlOpts?: ExtraScrappingOptions, crawlerOpts?: CrawlerOptions) {
        console.log('Starting scrap for URL:', urlToCrawl.toString());
        console.log('Crawl options:', crawlOpts);
        console.log('Crawler options:', crawlerOpts);

        if (crawlerOpts?.html) {
            console.log('Using provided HTML');
            const fakeSnapshot = {
                href: urlToCrawl.toString(),
                html: crawlerOpts.html,
                title: '',
                text: '',
            } as PageSnapshot;

            yield this.jsdomControl.narrowSnapshot(fakeSnapshot, crawlOpts);

            return;
        }

        if (crawlOpts?.targetSelector || crawlOpts?.removeSelector || crawlOpts?.withIframe) {
            console.log('Using custom selectors or iframe');
            for await (const x of this.puppeteerControl.scrap(urlToCrawl, crawlOpts)) {
                console.log('Narrowing snapshot');
                yield this.jsdomControl.narrowSnapshot(x, crawlOpts);
            }

            return;
        }

        console.log('Using default scraping method');
        yield* this.puppeteerControl.scrap(urlToCrawl, crawlOpts);
    }



    async *scrapMany(urls: URL[], options?: ExtraScrappingOptions, crawlerOpts?: CrawlerOptions) {
        const iterators = urls.map((url) => this.scrap(url, options, crawlerOpts));

        const results: (PageSnapshot | undefined)[] = iterators.map((_x) => undefined);

        let nextDeferred = Defer();
        let concluded = false;

        const handler = async (it: AsyncGenerator<PageSnapshot | undefined>, idx: number) => {
            try {
                for await (const x of it) {
                    results[idx] = x;

                    if (x) {
                        nextDeferred.resolve();
                        nextDeferred = Defer();
                    }

                }
            } catch (err: any) {
                this.logger.warn(`Failed to scrap ${urls[idx]}`, { err: marshalErrorLike(err) });
            }
        };

        Promise.all(
            iterators.map((it, idx) => handler(it, idx))
        ).finally(() => {
            concluded = true;
            nextDeferred.resolve();
        });

        yield results;

        try {
            while (!concluded) {
                await nextDeferred.promise;

                yield results;
            }
        } finally {
            for (const x of iterators) {
                x.return();
            }
        }
    }

    configure(opts: CrawlerOptions, req: Request, urlToCrawl: URL) {

        this.threadLocal.set('withGeneratedAlt', opts.withGeneratedAlt);
        this.threadLocal.set('withLinksSummary', opts.withLinksSummary);
        this.threadLocal.set('withImagesSummary', opts.withImagesSummary);
        this.threadLocal.set('keepImgDataUrl', opts.keepImgDataUrl);
        this.threadLocal.set('cacheTolerance', opts.cacheTolerance);
        this.threadLocal.set('userAgent', opts.userAgent);
        if (opts.timeout) {
            this.threadLocal.set('timeout', opts.timeout * 1000);
        }

        const cookies = req.headers['x-set-cookie'] ?
            (Array.isArray(req.headers['x-set-cookie']) ? req.headers['x-set-cookie'] : [req.headers['x-set-cookie']])
                .flatMap(cookieString =>
                    cookieString.split(';').map(cookie => {
                        const [name, ...valueParts] = cookie.trim().split('=');
                        const value = valueParts.join('=');
                        return { name, value, url: urlToCrawl.toString() };
                    })
                )
            : [];

        console.log('Cookies:', cookies);
        const crawlOpts: ExtraScrappingOptions = {
            proxyUrl: opts.proxyUrl,
            cookies: cookies,
            favorScreenshot: ['screenshot', 'pageshot'].includes(opts.respondWith),
            removeSelector: opts.removeSelector,
            targetSelector: opts.targetSelector,
            waitForSelector: opts.waitForSelector,
            overrideUserAgent: opts.userAgent,
            timeoutMs: opts.timeout ? opts.timeout * 1000 : undefined,
            withIframe: opts.withIframe,
        };

        return crawlOpts;
    }

    async simpleCrawl(mode: string, url: URL, opts?: ExtraScrappingOptions) {
        const it = this.scrap(url, { ...opts, minIntervalMs: 500 });

        let lastSnapshot;
        let goodEnough = false;
        try {
            for await (const x of it) {
                lastSnapshot = x;

                if (goodEnough) {
                    break;
                }

                if (lastSnapshot?.parsed?.content) {
                    // After it's good enough, wait for next snapshot;
                    goodEnough = true;
                }
            }

        } catch (err) {
            if (lastSnapshot) {
                return this.formatSnapshot(mode, lastSnapshot, url);
            }

            throw err;
        }

        if (!lastSnapshot) {
            throw new AssertionFailureError(`No content available`);
        }

        return this.formatSnapshot(mode, lastSnapshot, url);
    }

    configureTurndown() {
        const turnDownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });

        // Use the gfm plugin properly
        turnDownService.use(gfm);  // This enables all GFM features including tables

        // ... rest of turndown configuration ...

        return turnDownService;
    }
}

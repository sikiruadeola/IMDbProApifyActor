import { Actor } from 'apify';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
    type Locator,
    type StorageState,
} from 'playwright';

interface Person {
    imdbId: string;
    name: string;
    profileUrl: string;
    discoveryPage: number;
}

interface PersonRecord {
    imdbId: string;
    name: string;
    profileUrl: string;
    discoveryPage: number;
    contactEmail: string | null;
    contactUrl: string | null;
    directContactRaw: string | null;
    contactStatus: 'found' | 'not_found' | 'error';
    error: string | null;
}

interface ContactResult {
    email: string | null;
    url: string | null;
    raw: string | null;
    status: 'found' | 'not_found' | 'error';
    error: string | null;
}

interface Progress {
    lastCompletedPage: number;
    totalPeopleDiscovered: number;
    totalPeopleProcessed: number;
    totalPeopleWithContact: number;
    updatedAt: string;
}

interface Input {
    startUrl: string;
    authState: string;
    maxPages?: number;
    maxDirectors?: number;
}

const PROGRESS_KEY = 'SCRAPER_PROGRESS';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function normalizeText(value: string | null | undefined): string {
    return (value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractImdbId(href: string): string | null {
    const match = href.match(/\/name\/(nm\d+)/i);

    return match ? match[1] : null;
}

function extractEmail(text: string): string | null {
    const match = text.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    );

    return match ? match[0].trim() : null;
}

function extractUrl(text: string): string | null {
    const match = text.match(
        /https?:\/\/[^\s<>"']+/i,
    );

    if (!match) {
        return null;
    }

    return match[0]
        .replace(/[),.;]+$/, '')
        .trim();
}

function getPageNumberFromUrl(
    urlString: string,
): number {
    const url = new URL(urlString);

    const pageNumber = Number(
        url.searchParams.get('pageNumber') ?? '1',
    );

    if (
        !Number.isFinite(pageNumber)
        || pageNumber < 1
    ) {
        return 1;
    }

    return Math.floor(pageNumber);
}

function getUrlForPage(
    startUrl: string,
    pageNumber: number,
): string {
    const url = new URL(startUrl);

    url.searchParams.set(
        'pageNumber',
        String(pageNumber),
    );

    return url.toString();
}

async function isVisible(
    locator: Locator,
): Promise<boolean> {
    return locator
        .isVisible()
        .catch(() => false);
}

async function findVisibleLocator(
    page: Page,
    selectors: string[],
): Promise<Locator | null> {
    for (const selector of selectors) {
        const locator = page.locator(selector);

        const count =
            await locator.count().catch(() => 0);

        for (let i = 0; i < count; i++) {
            const candidate = locator.nth(i);

            if (await isVisible(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

async function safeClick(
    locator: Locator,
): Promise<boolean> {
    try {
        await locator
            .scrollIntoViewIfNeeded()
            .catch(() => {});

        await locator.click({
            timeout: 10_000,
        });

        return true;
    } catch (firstError) {
        console.warn(
            `Normal click failed: ${getErrorMessage(firstError)}`,
        );

        try {
            await locator.click({
                timeout: 10_000,
                force: true,
            });

            return true;
        } catch (secondError) {
            console.warn(
                `Force click failed: ${getErrorMessage(secondError)}`,
            );

            return false;
        }
    }
}

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

function parseAuthState(
    value: string,
): StorageState {
    let parsed: unknown;

    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(
            `authState is not valid JSON: ${getErrorMessage(error)}`,
        );
    }

    if (
        !parsed
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
    ) {
        throw new Error(
            'authState must be a Playwright storage-state JSON object.',
        );
    }

    const authState =
        parsed as StorageState;

    if (
        !Array.isArray(authState.cookies)
    ) {
        throw new Error(
            'authState does not contain a valid cookies array.',
        );
    }

    return authState;
}

// -----------------------------------------------------------------------------
// Direct Contact detection
// -----------------------------------------------------------------------------

async function getDirectContactButton(
    page: Page,
): Promise<Locator | null> {
    const selectors = [
        'button:has-text("Direct Contact")',
        '[role="button"]:has-text("Direct Contact")',
        'a:has-text("Direct Contact")',

        'button:has-text("Contact")',
        '[role="button"]:has-text("Contact")',
        'a:has-text("Contact")',

        '[aria-label*="Direct Contact" i]',
        '[title*="Direct Contact" i]',

        'text=Direct Contact',
    ];

    const found =
        await findVisibleLocator(
            page,
            selectors,
        );

    if (found) {
        return found;
    }

    const textMatches =
        page.getByText(
            'Direct Contact',
            {
                exact: false,
            },
        );

    const count =
        await textMatches
            .count()
            .catch(() => 0);

    for (let i = 0; i < count; i++) {
        const match =
            textMatches.nth(i);

        if (
            !await isVisible(match)
        ) {
            continue;
        }

        const clickable =
            match.locator(
                'xpath=ancestor-or-self::button | ancestor-or-self::*[@role="button"] | ancestor-or-self::a',
            ).first();

        if (
            await clickable
                .count()
                .catch(() => 0)
            && await isVisible(clickable)
        ) {
            return clickable;
        }

        return match;
    }

    return null;
}

// -----------------------------------------------------------------------------
// Find Copy button
// -----------------------------------------------------------------------------

async function getCopyButton(
    root: Locator,
): Promise<Locator | null> {
    const selectors = [
        'button:has-text("Copy")',
        '[role="button"]:has-text("Copy")',

        'button[aria-label*="Copy" i]',
        '[role="button"][aria-label*="Copy" i]',

        'button[title*="Copy" i]',
        '[role="button"][title*="Copy" i]',

        '[data-testid*="copy" i]',
        '[data-test*="copy" i]',
    ];

    for (const selector of selectors) {
        const locator =
            root.locator(selector);

        const count =
            await locator
                .count()
                .catch(() => 0);

        for (let i = 0; i < count; i++) {
            const candidate =
                locator.nth(i);

            if (
                await isVisible(candidate)
            ) {
                return candidate;
            }
        }
    }

    const textMatches =
        root.getByText(
            'Copy',
            {
                exact: false,
            },
        );

    const count =
        await textMatches
            .count()
            .catch(() => 0);

    for (let i = 0; i < count; i++) {
        const candidate =
            textMatches.nth(i);

        if (
            await isVisible(candidate)
        ) {
            return candidate;
        }
    }

    return null;
}

// -----------------------------------------------------------------------------
// Find opened contact container
// -----------------------------------------------------------------------------

async function findContactContainer(
    page: Page,
): Promise<Locator | null> {
    const selectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',

        '[data-testid*="direct-contact" i]',
        '[data-testid*="contact" i]',

        '[class*="direct-contact" i]',
        '[class*="contact" i]',
    ];

    const direct =
        await findVisibleLocator(
            page,
            selectors,
        );

    if (direct) {
        return direct;
    }

    const copyButton =
        await getCopyButton(
            page.locator('body'),
        );

    if (copyButton) {
        const parent =
            copyButton.locator(
                'xpath=ancestor::*[self::div or self::section or self::article][1]',
            );

        if (
            await parent
                .count()
                .catch(() => 0)
            && await isVisible(parent)
        ) {
            return parent;
        }
    }

    return null;
}

// -----------------------------------------------------------------------------
// Clipboard reader
// -----------------------------------------------------------------------------

async function readClipboard(
    page: Page,
): Promise<string> {
    try {
        const text =
            await page.evaluate(async () => {
                try {
                    return await navigator
                        .clipboard
                        .readText();
                } catch {
                    return '';
                }
            });

        return normalizeText(text);
    } catch {
        return '';
    }
}

// -----------------------------------------------------------------------------
// Extract all links from a root
// -----------------------------------------------------------------------------

async function getLinksFromRoot(
    root: Locator,
): Promise<string[]> {
    const links =
        root.locator('a[href]');

    const count =
        await links
            .count()
            .catch(() => 0);

    const hrefs: string[] = [];

    for (let i = 0; i < count; i++) {
        const href =
            await links
                .nth(i)
                .getAttribute('href')
                .catch(() => null);

        if (href) {
            hrefs.push(href);
        }
    }

    return hrefs;
}

// -----------------------------------------------------------------------------
// Extract Direct Contact
// -----------------------------------------------------------------------------

async function getDirectContact(
    page: Page,
): Promise<ContactResult> {
    try {
        console.log(
            'Searching for Direct Contact...',
        );

        let directContactButton =
            await getDirectContactButton(page);

        if (!directContactButton) {
            console.log(
                'Direct Contact not immediately visible. Waiting...',
            );

            await page.waitForTimeout(
                3_000,
            );

            directContactButton =
                await getDirectContactButton(page);
        }

        if (!directContactButton) {
            const body =
                page.locator('body');

            const bodyText =
                normalizeText(
                    await body
                        .innerText()
                        .catch(() => ''),
                );

            console.log(
                `Page contains "Direct Contact": ${
                    /direct contact/i.test(
                        bodyText,
                    )
                }`,
            );

            return {
                email: null,
                url: null,
                raw: null,
                status: 'not_found',
                error: null,
            };
        }

        console.log(
            'Direct Contact control found.',
        );

        const clicked =
            await safeClick(
                directContactButton,
            );

        if (!clicked) {
            return {
                email: null,
                url: null,
                raw: null,
                status: 'error',
                error:
                    'Direct Contact control was found but could not be clicked.',
            };
        }

        console.log(
            'Direct Contact clicked.',
        );

        await page.waitForTimeout(
            2_000,
        );

        let contactContainer =
            await findContactContainer(
                page,
            );

        if (!contactContainer) {
            await page.waitForTimeout(
                2_000,
            );

            contactContainer =
                await findContactContainer(
                    page,
                );
        }

        const searchRoot =
            contactContainer
            ?? page.locator('body');

        let copyButton =
            await getCopyButton(
                searchRoot,
            );

        if (!copyButton) {
            await page.waitForTimeout(
                2_000,
            );

            copyButton =
                await getCopyButton(
                    searchRoot,
                );
        }

        let visibleText =
            normalizeText(
                await searchRoot
                    .innerText()
                    .catch(() => ''),
            );

        let hrefs =
            await getLinksFromRoot(
                searchRoot,
            );

        let clipboardText = '';

        if (copyButton) {
            console.log(
                'Copy button found. Clicking...',
            );

            const copied =
                await safeClick(
                    copyButton,
                );

            if (copied) {
                await page.waitForTimeout(
                    750,
                );

                clipboardText =
                    await readClipboard(
                        page,
                    );
            }
        }

        const updatedContainer =
            await findContactContainer(
                page,
            );

        if (updatedContainer) {
            const updatedText =
                normalizeText(
                    await updatedContainer
                        .innerText()
                        .catch(() => ''),
                );

            if (
                updatedText.length
                > visibleText.length
            ) {
                visibleText =
                    updatedText;
            }

            const updatedLinks =
                await getLinksFromRoot(
                    updatedContainer,
                );

            hrefs = [
                ...new Set([
                    ...hrefs,
                    ...updatedLinks,
                ]),
            ];
        }

        const combinedText =
            [
                clipboardText,
                visibleText,
                hrefs.join('\n'),
            ]
                .filter(Boolean)
                .join('\n');

        const email =
            extractEmail(
                combinedText,
            );

        let contactUrl =
            extractUrl(
                combinedText,
            );

        if (!contactUrl) {
            for (const href of hrefs) {
                if (
                    /^https?:\/\//i.test(
                        href,
                    )
                ) {
                    contactUrl = href;
                    break;
                }
            }
        }

        if (
            clipboardText
            || visibleText
            || email
            || contactUrl
        ) {
            return {
                email,
                url: contactUrl,
                raw:
                    clipboardText
                    || visibleText
                    || combinedText
                    || null,
                status: 'found',
                error: null,
            };
        }

        return {
            email: null,
            url: null,
            raw: null,
            status: 'not_found',
            error: null,
        };
    } catch (error) {
        const message =
            getErrorMessage(error);

        console.error(
            `Direct Contact extraction error: ${message}`,
        );

        return {
            email: null,
            url: null,
            raw: null,
            status: 'error',
            error: message,
        };
    }
}

// -----------------------------------------------------------------------------
// Close Direct Contact
// -----------------------------------------------------------------------------

async function closeDirectContactIfOpen(
    page: Page,
): Promise<void> {
    const closeButton =
        await findVisibleLocator(
            page,
            [
                'button[aria-label*="Close" i]',
                '[role="button"][aria-label*="Close" i]',
                'button[title*="Close" i]',
                '[role="button"][title*="Close" i]',
                'button:has-text("Close")',
            ],
        );

    if (!closeButton) {
        return;
    }

    try {
        await safeClick(
            closeButton,
        );

        await page.waitForTimeout(
            300,
        );
    } catch {
        // Not fatal.
    }
}

// -----------------------------------------------------------------------------
// Process person
// -----------------------------------------------------------------------------

async function processPerson(
    page: Page,
    person: Person,
): Promise<PersonRecord> {
    console.log(
        '\n----------------------------------------',
    );

    console.log(
        `PROCESSING: ${person.name}`,
    );

    console.log(
        `IMDb ID: ${person.imdbId}`,
    );

    console.log(
        `Profile: ${person.profileUrl}`,
    );

    try {
        await page.goto(
            person.profileUrl,
            {
                waitUntil:
                    'domcontentloaded',
                timeout:
                    120_000,
            },
        );

        await page.waitForTimeout(
            2_500,
        );

        console.log(
            `Profile loaded: ${page.url()}`,
        );

        const contact =
            await getDirectContact(
                page,
            );

        return {
            imdbId:
                person.imdbId,

            name:
                person.name,

            profileUrl:
                person.profileUrl,

            discoveryPage:
                person.discoveryPage,

            contactEmail:
                contact.email,

            contactUrl:
                contact.url,

            directContactRaw:
                contact.raw,

            contactStatus:
                contact.status,

            error:
                contact.error,
        };
    } catch (error) {
        const message =
            getErrorMessage(error);

        console.error(
            `ERROR PROCESSING ${person.name}: ${message}`,
        );

        return {
            imdbId:
                person.imdbId,

            name:
                person.name,

            profileUrl:
                person.profileUrl,

            discoveryPage:
                person.discoveryPage,

            contactEmail:
                null,

            contactUrl:
                null,

            directContactRaw:
                null,

            contactStatus:
                'error',

            error:
                message,
        };
    } finally {
        await closeDirectContactIfOpen(
            page,
        );
    }
}

// -----------------------------------------------------------------------------
// Save progress
// -----------------------------------------------------------------------------

async function saveProgress(
    progress: Progress,
): Promise<void> {
    await Actor.setValue(
        PROGRESS_KEY,
        progress,
    );
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

await Actor.init();

try {
    const input =
        await Actor.getInput<Input>();

    if (
        !input?.startUrl
        || !input.startUrl.trim()
    ) {
        throw new Error(
            'startUrl is required.',
        );
    }

    if (
        !input.authState
        || !input.authState.trim()
    ) {
        throw new Error(
            'authState is required. Paste your Playwright storage-state JSON into the Actor input.',
        );
    }

    const startUrl =
        input.startUrl.trim();

    const authState =
        parseAuthState(
            input.authState.trim(),
        );

    let parsedStartUrl: URL;

    try {
        parsedStartUrl =
            new URL(startUrl);
    } catch {
        throw new Error(
            'The provided startUrl is not a valid URL.',
        );
    }

    const maxPages =
        Math.max(
            0,
            input.maxPages ?? 0,
        );

    const maxDirectors =
        Math.max(
            0,
            input.maxDirectors ?? 0,
        );

    const startPage =
        getPageNumberFromUrl(
            parsedStartUrl.toString(),
        );

    console.log(
        '\n==============================',
    );

    console.log(
        'IMDbPro CONTACT SCRAPER',
    );

    console.log(
        '==============================',
    );

    console.log(
        `Authentication cookies loaded: ${
            authState.cookies.length
        }`,
    );

    console.log(
        `Authentication origins loaded: ${
            authState.origins.length
        }`,
    );

    console.log(
        `Starting page: ${startPage}`,
    );

    console.log(
        `Maximum pages: ${
            maxPages === 0
                ? 'UNLIMITED'
                : maxPages
        }`,
    );

    console.log(
        `Maximum profiles: ${
            maxDirectors === 0
                ? 'UNLIMITED'
                : maxDirectors
        }`,
    );

    const browser: Browser =
        await chromium.launch({
            headless: true,
        });

    const context: BrowserContext =
        await browser.newContext({
            storageState:
                authState,

            viewport: {
                width: 1920,
                height: 1080,
            },
        });

    await context.grantPermissions(
        [
            'clipboard-read',
            'clipboard-write',
        ],
        {
            origin:
                'https://pro.imdb.com',
        },
    );

    const discoveryPage =
        await context.newPage();

    const profilePage =
        await context.newPage();

    const seenImdbIds =
        new Set<string>();

    let totalPeopleFound = 0;
    let totalPeopleProcessed = 0;
    let totalPeopleWithContact = 0;

    let lastCompletedPage =
        startPage - 1;

    let pageNumber =
        startPage;

    let pagesProcessed = 0;

    while (true) {
        if (
            maxPages > 0
            && pagesProcessed >= maxPages
        ) {
            break;
        }

        if (
            maxDirectors > 0
            && totalPeopleProcessed >= maxDirectors
        ) {
            break;
        }

        const discoveryUrl =
            pagesProcessed === 0
                ? startUrl
                : getUrlForPage(
                    startUrl,
                    pageNumber,
                );

        console.log(
            `\nOPENING DISCOVERY PAGE ${pageNumber}`,
        );

        await discoveryPage.goto(
            discoveryUrl,
            {
                waitUntil:
                    'domcontentloaded',
                timeout:
                    120_000,
            },
        );

        await discoveryPage.waitForTimeout(
            5_000,
        );

        const nameLinks =
            discoveryPage.locator(
                'a[href*="/name/nm"]',
            );

        const count =
            await nameLinks.count();

        console.log(
            `NAME LINKS FOUND: ${count}`,
        );

        if (count === 0) {
            console.log(
                'No people found. Stopping.',
            );

            break;
        }

        const peopleOnPage:
            Person[] = [];

        for (
            let i = 0;
            i < count;
            i++
        ) {
            if (
                maxDirectors > 0
                && (
                    totalPeopleProcessed
                    + peopleOnPage.length
                ) >= maxDirectors
            ) {
                break;
            }

            const link =
                nameLinks.nth(i);

            const href =
                await link
                    .getAttribute('href')
                    .catch(() => null);

            if (!href) {
                continue;
            }

            const imdbId =
                extractImdbId(href);

            if (!imdbId) {
                continue;
            }

            if (
                seenImdbIds.has(
                    imdbId,
                )
            ) {
                continue;
            }

            seenImdbIds.add(
                imdbId,
            );

            const rawName =
                normalizeText(
                    await link
                        .innerText()
                        .catch(() => ''),
                );

            const name =
                rawName
                    .replace(
                        /\s+(Actor|Actress|Director|Writer|Producer|Cinematographer|Editor|Composer)\b.*$/i,
                        '',
                    )
                    .trim()
                || rawName;

            const profileUrl =
                new URL(
                    href,
                    'https://pro.imdb.com',
                ).toString();

            peopleOnPage.push({
                imdbId,
                name,
                profileUrl,
                discoveryPage:
                    pageNumber,
            });

            totalPeopleFound++;
        }

        console.log(
            `UNIQUE PEOPLE TO PROCESS: ${peopleOnPage.length}`,
        );

        for (
            const person
            of peopleOnPage
        ) {
            if (
                maxDirectors > 0
                && totalPeopleProcessed >= maxDirectors
            ) {
                break;
            }

            const result =
                await processPerson(
                    profilePage,
                    person,
                );

            totalPeopleProcessed++;

            if (
                result.contactStatus === 'found'
                && (
                    result.contactEmail
                    || result.contactUrl
                    || result.directContactRaw
                )
            ) {
                totalPeopleWithContact++;

                await Actor.pushData({
                    name:
                        result.name,

                    imdbId:
                        result.imdbId,

                    profileUrl:
                        result.profileUrl,

                    discoveryPage:
                        result.discoveryPage,

                    directContact:
                        result.directContactRaw,

                    contactEmail:
                        result.contactEmail,

                    contactUrl:
                        result.contactUrl,
                });
            }

            console.log(
                `Processed: ${totalPeopleProcessed}`,
            );

            console.log(
                `Contacts found: ${totalPeopleWithContact}`,
            );
        }

        lastCompletedPage =
            pageNumber;

        pagesProcessed++;

        await saveProgress({
            lastCompletedPage,
            totalPeopleDiscovered:
                totalPeopleFound,
            totalPeopleProcessed,
            totalPeopleWithContact,
            updatedAt:
                new Date().toISOString(),
        });

        pageNumber++;
    }

    console.log(
        '\n==============================',
    );

    console.log(
        'SCRAPING FINISHED',
    );

    console.log(
        '==============================',
    );

    console.log(
        `People processed: ${totalPeopleProcessed}`,
    );

    console.log(
        `Contacts found: ${totalPeopleWithContact}`,
    );

    console.log(
        `Last page completed: ${lastCompletedPage}`,
    );

    await profilePage.close();
    await discoveryPage.close();
    await browser.close();

} finally {
    await Actor.exit();
}

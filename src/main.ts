import { Actor } from 'apify';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
    type Locator,
} from 'playwright';
import fs from 'node:fs';

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
    maxPages?: number;
    maxDirectors?: number;
}

const STORAGE_FILE = './imdb-auth-state.json';
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
    return (value ?? '').replace(/\s+/g, ' ').trim();
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
        await locator.scrollIntoViewIfNeeded()
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

    // Broader fallback:
    // Find any visible element containing the text and then
    // walk up to a clickable ancestor.

    const textMatches =
        page.getByText(
            'Direct Contact',
            {
                exact: false,
            },
        );

    const count =
        await textMatches.count()
            .catch(() => 0);

    for (let i = 0; i < count; i++) {
        const match =
            textMatches.nth(i);

        if (!await isVisible(match)) {
            continue;
        }

        const clickable =
            match.locator(
                'xpath=ancestor-or-self::button | ancestor-or-self::*[@role="button"] | ancestor-or-self::a',
            ).first();

        if (
            await clickable.count()
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
            await locator.count()
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
        await textMatches.count()
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

    // Look for a visible Copy button and use one of its ancestors.

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
            await parent.count()
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
                    return await navigator.clipboard.readText();
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
        await links.count()
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

        // ---------------------------------------------------------------------
        // First search normally.
        // ---------------------------------------------------------------------

        let directContactButton =
            await getDirectContactButton(page);

        // ---------------------------------------------------------------------
        // Retry after a longer wait.
        // ---------------------------------------------------------------------

        if (!directContactButton) {
            console.log(
                'Direct Contact not immediately visible. Waiting...',
            );

            await page.waitForTimeout(3_000);

            directContactButton =
                await getDirectContactButton(page);
        }

        // ---------------------------------------------------------------------
        // Scroll through the page looking for the UI.
        // ---------------------------------------------------------------------

        if (!directContactButton) {
            console.log(
                'Trying page-wide Direct Contact search...',
            );

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
                    /direct contact/i.test(bodyText)
                }`,
            );
        }

        if (!directContactButton) {
            console.log(
                'Direct Contact control was not found.',
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

        // ---------------------------------------------------------------------
        // Click Direct Contact.
        // ---------------------------------------------------------------------

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

        // Give IMDbPro UI time to render.

        await page.waitForTimeout(2_000);

        // ---------------------------------------------------------------------
        // Find the newly opened contact area.
        // ---------------------------------------------------------------------

        let contactContainer =
            await findContactContainer(page);

        if (!contactContainer) {
            console.log(
                'Contact container not immediately found. Waiting...',
            );

            await page.waitForTimeout(2_000);

            contactContainer =
                await findContactContainer(page);
        }

        // Use body as the final fallback.

        const searchRoot =
            contactContainer
            ?? page.locator('body');

        // ---------------------------------------------------------------------
        // Find Copy button INSIDE the opened contact area.
        // ---------------------------------------------------------------------

        let copyButton =
            await getCopyButton(
                searchRoot,
            );

        if (!copyButton) {
            console.log(
                'Copy button not immediately found. Waiting...',
            );

            await page.waitForTimeout(2_000);

            copyButton =
                await getCopyButton(
                    searchRoot,
                );
        }

        // ---------------------------------------------------------------------
        // Read visible text BEFORE clicking Copy.
        // ---------------------------------------------------------------------

        let visibleText =
            normalizeText(
                await searchRoot
                    .innerText()
                    .catch(() => ''),
            );

        console.log(
            `Contact area text length: ${visibleText.length}`,
        );

        // ---------------------------------------------------------------------
        // Extract links before Copy.
        // ---------------------------------------------------------------------

        let hrefs =
            await getLinksFromRoot(
                searchRoot,
            );

        // ---------------------------------------------------------------------
        // Click Copy and read clipboard.
        // ---------------------------------------------------------------------

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
                    await readClipboard(page);

                if (clipboardText) {
                    console.log(
                        `Clipboard successfully read (${clipboardText.length} characters).`,
                    );
                } else {
                    console.log(
                        'Copy button clicked, but clipboard returned empty.',
                    );
                }
            }
        } else {
            console.log(
                'Copy button not found in contact area.',
            );
        }

        // ---------------------------------------------------------------------
        // Re-read UI after Copy in case it changed/rendered.
        // ---------------------------------------------------------------------

        const updatedContainer =
            await findContactContainer(page);

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

        // ---------------------------------------------------------------------
        // Combine every possible source.
        // ---------------------------------------------------------------------

        const combinedText =
            [
                clipboardText,
                visibleText,
                hrefs.join('\n'),
            ]
                .filter(Boolean)
                .join('\n');

        console.log(
            `Combined contact data length: ${combinedText.length}`,
        );

        // ---------------------------------------------------------------------
        // Extract email.
        // ---------------------------------------------------------------------

        const email =
            extractEmail(
                combinedText,
            );

        // ---------------------------------------------------------------------
        // Extract URL.
        // ---------------------------------------------------------------------

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

        // ---------------------------------------------------------------------
        // Final result.
        // ---------------------------------------------------------------------

        if (
            clipboardText
            || visibleText
            || email
            || contactUrl
        ) {
            console.log(
                'Direct Contact information successfully detected.',
            );

            return {
                email,
                url: contactUrl,

                // Clipboard is preferred because this is the
                // exact content supplied by IMDbPro's Copy button.

                raw:
                    clipboardText
                    || visibleText
                    || combinedText
                    || null,

                status: 'found',
                error: null,
            };
        }

        console.log(
            'Direct Contact was opened, but no contact data could be extracted.',
        );

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
    console.log('\n----------------------------------------');
    console.log(`PROCESSING: ${person.name}`);
    console.log(`IMDb ID: ${person.imdbId}`);
    console.log(`Profile: ${person.profileUrl}`);
    console.log(
        `Discovery page: ${person.discoveryPage}`,
    );
    console.log('----------------------------------------');

    try {
        let loaded = false;

        for (
            let attempt = 1;
            attempt <= 2;
            attempt++
        ) {
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

                loaded = true;

                break;
            } catch (error) {
                console.warn(
                    `Profile load attempt ${attempt} failed: ${getErrorMessage(error)}`,
                );

                if (attempt === 2) {
                    throw error;
                }

                await page.waitForTimeout(
                    2_000,
                );
            }
        }

        if (!loaded) {
            throw new Error(
                'Profile could not be loaded.',
            );
        }

        console.log(
            `Profile loaded: ${page.url()}`,
        );

        const contact =
            await getDirectContact(
                page,
            );

        console.log(
            `Contact status: ${contact.status}`,
        );

        if (contact.email) {
            console.log(
                `EMAIL: ${contact.email}`,
            );
        }

        if (contact.url) {
            console.log(
                `CONTACT URL: ${contact.url}`,
            );
        }

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

const input =
    (await Actor.getInput()) as Input | null;

if (
    !input?.startUrl
    || !input.startUrl.trim()
) {
    throw new Error(
        'startUrl is required. Paste the exact IMDbPro discovery URL you want to scrape.',
    );
}

const startUrl =
    input.startUrl.trim();

let parsedStartUrl: URL;

try {
    parsedStartUrl =
        new URL(
            startUrl,
        );
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

console.log('\n==============================');
console.log('IMDbPro CONTACT SCRAPER');
console.log('==============================');

console.log(
    'REQUESTED START URL:',
);

console.log(
    startUrl,
);

console.log(
    `START PAGE READ FROM URL: ${startPage}`,
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

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

if (
    !fs.existsSync(
        STORAGE_FILE,
    )
) {
    throw new Error(
        `Authentication file not found: ${STORAGE_FILE}`,
    );
}

console.log(
    'Loading saved IMDbPro authentication...',
);

const browser: Browser =
    await chromium.launch({
        headless: true,
    });

const context: BrowserContext =
    await browser.newContext({
        storageState:
            STORAGE_FILE,

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

// -----------------------------------------------------------------------------
// Counters
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Pagination
// -----------------------------------------------------------------------------

while (true) {
    if (
        maxPages > 0
        && pagesProcessed >= maxPages
    ) {
        console.log(
            `Reached configured page limit: ${maxPages}`,
        );

        break;
    }

    if (
        maxDirectors > 0
        && totalPeopleProcessed >= maxDirectors
    ) {
        console.log(
            `Reached configured profile limit: ${maxDirectors}`,
        );

        break;
    }

    console.log('\n==============================');

    console.log(
        `OPENING DISCOVERY PAGE ${pageNumber}`,
    );

    console.log('==============================');

    const discoveryUrl =
        pagesProcessed === 0
            ? startUrl
            : getUrlForPage(
                startUrl,
                pageNumber,
            );

    console.log(
        'DISCOVERY URL BEING OPENED:',
    );

    console.log(
        discoveryUrl,
    );

    let discoveryLoaded = false;

    for (
        let attempt = 1;
        attempt <= 2;
        attempt++
    ) {
        try {
            await discoveryPage.goto(
                discoveryUrl,
                {
                    waitUntil:
                        'domcontentloaded',

                    timeout:
                        120_000,
                },
            );

            console.log(
                'Waiting for results to load...',
            );

            await discoveryPage.waitForTimeout(
                5_000,
            );

            discoveryLoaded = true;

            break;
        } catch (error) {
            console.error(
                `Discovery page ${pageNumber} attempt ${attempt} failed: ${getErrorMessage(error)}`,
            );

            if (
                attempt < 2
            ) {
                await discoveryPage.waitForTimeout(
                    2_000,
                );
            }
        }
    }

    if (
        !discoveryLoaded
    ) {
        console.error(
            `Could not load discovery page ${pageNumber}. Stopping.`,
        );

        break;
    }

    console.log(
        '\nACTUAL DISCOVERY URL AFTER PAGE LOAD:',
    );

    console.log(
        discoveryPage.url(),
    );

    console.log(
        'DISCOVERY PAGE TITLE:',
    );

    console.log(
        await discoveryPage.title(),
    );

    const nameLinks =
        discoveryPage.locator(
            'a[href*="/name/nm"]',
        );

    const count =
        await nameLinks.count();

    console.log(
        `NAME LINKS FOUND ON PAGE ${pageNumber}: ${count}`,
    );

    if (
        count === 0
    ) {
        console.log(
            `No people found on page ${pageNumber}.`,
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

        const name =
            normalizeText(
                await link
                    .innerText()
                    .catch(() => ''),
            );

        const href =
            await link
                .getAttribute(
                    'href',
                )
                .catch(() => null);

        if (
            !href
        ) {
            continue;
        }

        const imdbId =
            extractImdbId(
                href,
            );

        if (
            !imdbId
        ) {
            continue;
        }

        const profileUrl =
            new URL(
                href,
                discoveryPage.url(),
            ).toString();

        totalPeopleFound++;

        if (
            seenImdbIds.has(
                imdbId,
            )
        ) {
            console.log(
                `DUPLICATE SKIPPED: ${name} (${imdbId})`,
            );

            continue;
        }

        seenImdbIds.add(
            imdbId,
        );

        peopleOnPage.push({
            imdbId,
            name,
            profileUrl,

            discoveryPage:
                pageNumber,
        });
    }

    console.log(
        `UNIQUE PEOPLE ON PAGE ${pageNumber}: ${peopleOnPage.length}`,
    );

    console.log(
        '\nFIRST PEOPLE FOUND ON THIS DISCOVERY PAGE:',
    );

    const verificationCount =
        Math.min(
            10,
            peopleOnPage.length,
        );

    for (
        let i = 0;
        i < verificationCount;
        i++
    ) {
        const person =
            peopleOnPage[i];

        console.log(
            `${i + 1}. ${person.name} (${person.imdbId})`,
        );
    }

    console.log(
        '----------------------------------------',
    );

    // -------------------------------------------------------------------------
    // Process each person
    // -------------------------------------------------------------------------

    for (
        const person of peopleOnPage
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
        }

        if (
            result.contactStatus === 'found'
        ) {
            const directContact =
                result.directContactRaw
                || result.contactEmail
                || result.contactUrl;

            if (
                directContact
            ) {
                await Actor.pushData({
                    name:
                        result.name,

                    imdbId:
                        result.imdbId,

                    profileUrl:
                        result.profileUrl,

                    discoveryPage:
                        result.discoveryPage,

                    directContact,

                    contactEmail:
                        result.contactEmail,

                    contactUrl:
                        result.contactUrl,
                });
            }
        }

        console.log(
            `Processed: ${totalPeopleProcessed}`,
        );

        console.log(
            `Contacts found so far: ${totalPeopleWithContact}`,
        );
    }

    // -------------------------------------------------------------------------
    // Save progress
    // -------------------------------------------------------------------------

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

    console.log(
        '\n----------------------------------------',
    );

    console.log(
        `COMPLETED DISCOVERY PAGE ${pageNumber}`,
    );

    console.log(
        `Last completed page: ${lastCompletedPage}`,
    );

    console.log(
        `Total unique people: ${seenImdbIds.size}`,
    );

    console.log(
        `Total processed: ${totalPeopleProcessed}`,
    );

    console.log(
        `Total contacts found: ${totalPeopleWithContact}`,
    );

    console.log(
        '----------------------------------------',
    );

    pageNumber++;
}

// -----------------------------------------------------------------------------
// Final summary
// -----------------------------------------------------------------------------

console.log('\n==============================');
console.log('SCRAPING STOPPED / FINISHED');
console.log('==============================');

console.log(
    `Last completed discovery page: ${lastCompletedPage}`,
);

console.log(
    `People discovered: ${totalPeopleFound}`,
);

console.log(
    `Unique people: ${seenImdbIds.size}`,
);

console.log(
    `People processed: ${totalPeopleProcessed}`,
);

console.log(
    `People with contact data: ${totalPeopleWithContact}`,
);

console.log(
    `People without contact: ${
        totalPeopleProcessed
        - totalPeopleWithContact
    }`,
);

console.log(
    '==============================',
);

await profilePage.close();

await discoveryPage.close();

await browser.close();

await Actor.exit();
